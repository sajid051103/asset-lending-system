#!/usr/bin/env bash
#
# Automated tests for the fees feature (late fee, replacement charge,
# permission checks) and the archived-item loan block.
#
# Requirements: curl, jq, node (for backdating due_date directly in the DB
# via server/scripts/backdate-loan.js — the API itself refuses to accept
# a past due_date, so this is the only way to simulate an overdue loan
# without waiting real days. Uses the server's own 'pg' package, so no
# separate psql install is needed).
#
# Usage — run this from the project root (the folder containing server/
# and client/), so the relative path to server/scripts/backdate-loan.js
# resolves correctly:
#   BASE_URL=http://localhost:3000 \
#   DATABASE_URL=postgres://user:pass@localhost:5432/library \
#   ./test-fees.sh
#
# Both env vars have defaults below — edit them or export before running.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
DATABASE_URL="${DATABASE_URL:-postgres://localhost/library}"
PASSWORD="TestPass123!"

PASS=0
FAIL=0

pass() { echo "✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ FAIL: $1"; FAIL=$((FAIL + 1)); }
jget() { echo "$1" | jq -r "$2"; }

# Cross-platform "tomorrow's date" (GNU date vs BSD/macOS date)
tomorrow() { date -d "+1 day" +%Y-%m-%d 2>/dev/null || date -v+1d +%Y-%m-%d; }

echo "Testing against: $BASE_URL"
echo "DB:              $DATABASE_URL"
echo ""

# ============================================================
# SETUP — create disposable test users + a test item
# ============================================================
echo "== Setup: creating test users =="

STAMP=$(date +%s)
LIB_EMAIL="test-librarian-$STAMP@test.com"
MEMBER_EMAIL="test-member-$STAMP@test.com"
OTHER_EMAIL="test-other-member-$STAMP@test.com"

curl -s -X POST "$BASE_URL/api/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$LIB_EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Test Librarian\",\"role\":\"librarian\"}" > /dev/null

curl -s -X POST "$BASE_URL/api/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$MEMBER_EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Test Member\",\"role\":\"member\"}" > /dev/null

curl -s -X POST "$BASE_URL/api/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$OTHER_EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Other Member\",\"role\":\"member\"}" > /dev/null

LIB_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$LIB_EMAIL\",\"password\":\"$PASSWORD\"}")
LIB_TOKEN=$(jget "$LIB_LOGIN" '.token')

if [ "$LIB_TOKEN" == "null" ] || [ -z "$LIB_TOKEN" ]; then
  echo "❌ Could not log in as librarian. Is the server running at $BASE_URL?"
  echo "   Response: $LIB_LOGIN"
  exit 1
fi

MEMBER_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$MEMBER_EMAIL\",\"password\":\"$PASSWORD\"}")
MEMBER_TOKEN=$(jget "$MEMBER_LOGIN" '.token')
MEMBER_ID=$(jget "$MEMBER_LOGIN" '.user.id')

OTHER_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$OTHER_EMAIL\",\"password\":\"$PASSWORD\"}")
OTHER_TOKEN=$(jget "$OTHER_LOGIN" '.token')

ITEM_RESP=$(curl -s -X POST "$BASE_URL/api/items" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"title\":\"Fees Test Item\",\"category\":\"Testing\",\"code\":\"TEST-FEE-$STAMP\"}")
ITEM_ID=$(jget "$ITEM_RESP" '.item.id')

if [ "$ITEM_ID" == "null" ] || [ -z "$ITEM_ID" ]; then
  echo "❌ Could not create test item. Response: $ITEM_RESP"
  exit 1
fi

echo "Setup done. Item: $ITEM_ID"

# ============================================================
# TEST 1 — Late fee calculated correctly (5 days overdue)
# ============================================================
echo ""
echo "== Test 1: Late fee for a 5-day-overdue return =="

LOAN1_RESP=$(curl -s -X POST "$BASE_URL/api/loans" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"item_id\":\"$ITEM_ID\",\"borrower_id\":\"$MEMBER_ID\",\"due_date\":\"$(tomorrow)\"}")
LOAN1_ID=$(jget "$LOAN1_RESP" '.loan.id')

if [ "$LOAN1_ID" == "null" ] || [ -z "$LOAN1_ID" ]; then
  fail "Could not create loan for Test 1: $LOAN1_RESP"
else
  # Backdate due_date directly in the DB — the API rejects past due
  # dates on creation, so this is the only way to simulate "overdue".
  # Uses the server's own pg package (server/node_modules) instead of
  # requiring psql to be installed separately.
  node server/scripts/backdate-loan.js "$LOAN1_ID" -5

  RETURN1_RESP=$(curl -s -X PATCH "$BASE_URL/api/loans/$LOAN1_ID/return" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" -d '{}')
  DAYS_LATE=$(jget "$RETURN1_RESP" '.lateFee.days_late')
  AMOUNT=$(jget "$RETURN1_RESP" '.lateFee.amount')

  if [ "$DAYS_LATE" == "5" ] && [ "$AMOUNT" == "50" ]; then
    pass "5 days late -> ₹50 (days_late=$DAYS_LATE, amount=$AMOUNT)"
  else
    fail "Expected days_late=5 amount=50, got days_late=$DAYS_LATE amount=$AMOUNT. Response: $RETURN1_RESP"
  fi
fi

# ============================================================
# TEST 2 — Returned exactly on due date -> no fee
# ============================================================
echo ""
echo "== Test 2: No fee when returned exactly on the due date =="

LOAN2_RESP=$(curl -s -X POST "$BASE_URL/api/loans" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"item_id\":\"$ITEM_ID\",\"borrower_id\":\"$MEMBER_ID\",\"due_date\":\"$(tomorrow)\"}")
LOAN2_ID=$(jget "$LOAN2_RESP" '.loan.id')

if [ "$LOAN2_ID" == "null" ] || [ -z "$LOAN2_ID" ]; then
  fail "Could not create loan for Test 2 (does the item still have an open loan from Test 1?): $LOAN2_RESP"
else
  node server/scripts/backdate-loan.js "$LOAN2_ID" 0

  RETURN2_RESP=$(curl -s -X PATCH "$BASE_URL/api/loans/$LOAN2_ID/return" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" -d '{}')
  LATE_FEE2=$(jget "$RETURN2_RESP" '.lateFee')

  if [ "$LATE_FEE2" == "null" ]; then
    pass "No late fee charged (lateFee: null)"
  else
    fail "Expected lateFee: null, got $LATE_FEE2. Response: $RETURN2_RESP"
  fi
fi

# ============================================================
# TEST 3 — Replacement charge on marking a loan lost
# ============================================================
echo ""
echo "== Test 3: Flat replacement charge when a loan is marked lost =="

LOAN3_RESP=$(curl -s -X POST "$BASE_URL/api/loans" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"item_id\":\"$ITEM_ID\",\"borrower_id\":\"$MEMBER_ID\",\"due_date\":\"$(tomorrow)\"}")
LOAN3_ID=$(jget "$LOAN3_RESP" '.loan.id')

if [ "$LOAN3_ID" == "null" ] || [ -z "$LOAN3_ID" ]; then
  fail "Could not create loan for Test 3: $LOAN3_RESP"
else
  LOST_RESP=$(curl -s -X PATCH "$BASE_URL/api/loans/$LOAN3_ID/lost" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
    -d '{"note":"Automated test - simulated loss"}')
  CHARGE=$(jget "$LOST_RESP" '.replacementCharge')

  if [ "$CHARGE" == "500" ]; then
    pass "Replacement charge = ₹500"
  else
    fail "Expected replacementCharge=500, got $CHARGE. Response: $LOST_RESP"
  fi
fi

# ============================================================
# TEST 4 — Fees endpoint permissions
# ============================================================
echo ""
echo "== Test 4: GET /:id/fees permissions =="

if [ "${LOAN1_ID:-null}" != "null" ] && [ -n "${LOAN1_ID:-}" ]; then
  LIB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/loans/$LOAN1_ID/fees" -H "Authorization: Bearer $LIB_TOKEN")
  [ "$LIB_STATUS" == "200" ] && pass "Librarian can view fees (200)" || fail "Librarian fee view expected 200, got $LIB_STATUS"

  OWNER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/loans/$LOAN1_ID/fees" -H "Authorization: Bearer $MEMBER_TOKEN")
  [ "$OWNER_STATUS" == "200" ] && pass "Borrower can view own loan's fees (200)" || fail "Borrower fee view expected 200, got $OWNER_STATUS"

  OTHER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/loans/$LOAN1_ID/fees" -H "Authorization: Bearer $OTHER_TOKEN")
  [ "$OTHER_STATUS" == "403" ] && pass "Other member blocked from viewing someone else's fees (403)" || fail "Other member fee view expected 403, got $OTHER_STATUS"
else
  fail "Skipped Test 4 — Test 1's loan was never created"
fi

# ============================================================
# TEST 5 — Archived item blocks new loan creation
# ============================================================
echo ""
echo "== Test 5: Cannot create a loan for an archived item =="

ITEM2_RESP=$(curl -s -X POST "$BASE_URL/api/items" -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"title\":\"Archived Test Item\",\"category\":\"Testing\",\"code\":\"TEST-ARCH-$STAMP\"}")
ITEM2_ID=$(jget "$ITEM2_RESP" '.item.id')

curl -s -X PATCH "$BASE_URL/api/items/$ITEM2_ID/archive" -H "Authorization: Bearer $LIB_TOKEN" > /dev/null

ARCHIVED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/loans" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LIB_TOKEN" \
  -d "{\"item_id\":\"$ITEM2_ID\",\"borrower_id\":\"$MEMBER_ID\"}")

[ "$ARCHIVED_STATUS" == "409" ] && pass "Loan creation blocked for archived item (409)" || fail "Expected 409, got $ARCHIVED_STATUS"

# ============================================================
# SUMMARY
# ============================================================
echo ""
echo "================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "================================"

[ "$FAIL" -gt 0 ] && exit 1
exit 0