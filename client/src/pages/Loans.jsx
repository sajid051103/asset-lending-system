import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function Loans() {
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [borrowerFilter, setBorrowerFilter] = useState('');
  const [sortBy, setSortBy] = useState('requested_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  // dropdown options for the item/borrower filters
  const [itemOptions, setItemOptions] = useState([]);
  const [borrowerOptions, setBorrowerOptions] = useState([]);

  // per-row issue action
  const [issuingLoanId, setIssuingLoanId] = useState(null);
  const [dueDateInput, setDueDateInput] = useState('');
  const [submittingIssueLoanId, setSubmittingIssueLoanId] = useState(null);

  // per-row "mark lost" action — inline note input, replaces window.prompt()
  const [losingLoanId, setLosingLoanId] = useState(null);
  const [lostNoteInput, setLostNoteInput] = useState('');
  const [returningLoanId, setReturningLoanId] = useState(null);
  const [markingLostLoanId, setMarkingLostLoanId] = useState(null);

  // bulk return
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // notice banner — reused for reminder feedback, return/lost fee callouts
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', message: string }
  const [sendingReminderId, setSendingReminderId] = useState(null);

  // Send-reminder cooldown — mirrors the backend's 60-minute rule (see
  // REMINDER_COOLDOWN_MINUTES in loans.js). Keyed by loan id, value is
  // the timestamp (ms) at which the button re-enables. This is purely
  // client-side UX sugar so a librarian sees a countdown instead of
  // hammering the button into a 429 — the server is still the actual
  // source of truth and re-checks this on every request regardless of
  // what the button shows (e.g. after a page refresh, this state resets
  // and the server will correctly reject an early resend anyway).
  const [reminderCooldowns, setReminderCooldowns] = useState({});

  // Ticks once a second so the cooldown countdown text actually counts
  // down instead of only updating on the next unrelated re-render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  function getRemainingSeconds(loanId) {
    const until = reminderCooldowns[loanId];
    if (!until) return 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  function formatCooldown(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function showNotice(type, message) {
    setNotice({ type, message });
  }

  async function loadLoans() {
    setLoading(true);
    try {
      const params = {
        search,
        status,
        sortBy,
        sortOrder,
        page,
        limit: 10,
        ...(itemFilter && { item_id: itemFilter }),
        // borrower_id is only honoured by the backend for librarians — a
        // member's own requests are always scoped to themselves anyway,
        // so there's no point sending it for members.
        ...(borrowerFilter && user.role === 'librarian' && { borrower_id: borrowerFilter }),
      };
      const response = await api.get('/api/loans', { params });
      setLoans(response.data.loans);
      setTotal(response.data.total);
    } catch (err) {
      setError('Could not load loans');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, itemFilter, borrowerFilter, sortBy, sortOrder, page]);

  // Load the options for the item/borrower filter dropdowns once on mount.
  // Item list is available to any logged-in user; the borrower list
  // endpoint is librarian-only, so members simply won't get that dropdown.
  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const itemsResponse = await api.get('/api/items');
        setItemOptions(itemsResponse.data.items);
      } catch (err) {
        // Non-fatal — the item filter just won't have options
      }

      if (user.role === 'librarian') {
        try {
          const membersResponse = await api.get('/api/users', { params: { role: 'member' } });
          setBorrowerOptions(membersResponse.data.users);
        } catch (err) {
          // Non-fatal — the borrower filter just won't have options
        }
      }
    }
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss the notice banner after a few seconds
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function handleIssue(loanId) {
    if (!dueDateInput) {
      alert('Please pick a due date first');
      return;
    }
    setSubmittingIssueLoanId(loanId);
    try {
      await api.patch(`/api/loans/${loanId}/issue`, { due_date: dueDateInput });
      setIssuingLoanId(null);
      setDueDateInput('');
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not issue this loan');
    } finally {
      setSubmittingIssueLoanId(null);
    }
  }

  async function handleReturn(loanId) {
    setReturningLoanId(loanId);
    try {
      const response = await api.patch(`/api/loans/${loanId}/return`, {});
      const { lateFee } = response.data;

      // lateFee is computed server-side (fees.js) from the calendar-date
      // difference — we're just displaying what the backend already
      // decided and charged, not calculating anything here.
      if (lateFee) {
        showNotice(
          'error',
          `Item returned — ${lateFee.days_late} day(s) late, ₹${lateFee.amount} late fee charged.`
        );
      } else {
        showNotice('success', 'Item returned — no late fee.');
      }
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not process the return');
    } finally {
      setReturningLoanId(null);
    }
  }

  // Opens the inline note input for this row (replaces the old window.prompt flow)
  function openLostForm(loanId) {
    setLosingLoanId(loanId);
    setLostNoteInput('');
  }

  function cancelLostForm() {
    setLosingLoanId(null);
    setLostNoteInput('');
  }

  async function handleLost(loanId) {
    setMarkingLostLoanId(loanId);
    try {
      const response = await api.patch(`/api/loans/${loanId}/lost`, { note: lostNoteInput });
      const { replacementCharge } = response.data;

      setLosingLoanId(null);
      setLostNoteInput('');
      showNotice('error', `Item marked lost — ₹${replacementCharge} replacement charge added.`);
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not mark this loan as lost');
    } finally {
      setMarkingLostLoanId(null);
    }
  }

  async function handleSendReminder(loanId) {
    setSendingReminderId(loanId);
    setNotice(null);
    try {
      await api.post(`/api/loans/${loanId}/send-reminder`, {});
      showNotice('success', 'Reminder email sent to the borrower.');
      // Start a 60-minute client-side cooldown so the button immediately
      // reflects the same window the backend just started enforcing.
      setReminderCooldowns((prev) => ({
        ...prev,
        [loanId]: Date.now() + 60 * 60 * 1000,
      }));
    } catch (err) {
      const message = err.response?.data?.error || 'Could not send the reminder email.';
      showNotice('error', message);

      // If the backend rejected this as a cooldown violation (429), pull
      // the "X more minute(s)" figure out of its message so the button's
      // countdown matches what the server is actually enforcing, instead
      // of guessing or leaving the button clickable again immediately.
      if (err.response?.status === 429) {
        const match = message.match(/wait (\d+) more minute/i);
        const minutesRemaining = match ? parseInt(match[1], 10) : 60;
        setReminderCooldowns((prev) => ({
          ...prev,
          [loanId]: Date.now() + minutesRemaining * 60 * 1000,
        }));
      }
    } finally {
      setSendingReminderId(null);
    }
  }

  function toggleSelect(loanId) {
    setSelectedIds((prev) =>
      prev.includes(loanId) ? prev.filter((id) => id !== loanId) : [...prev, loanId]
    );
  }

  async function handleBulkReturn() {
    if (selectedIds.length === 0) {
      alert('Select at least one issued loan first');
      return;
    }
    setBulkProcessing(true);
    setBulkResult(null);
    try {
      const response = await api.post('/api/bulk/loans-return', { loan_ids: selectedIds });
      setBulkResult(response.data);
      setSelectedIds([]);
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Something went wrong with the bulk return');
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleExport() {
    try {
      const response = await api.get('/api/bulk/loans-export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'items-on-loan.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Could not export loans');
    }
  }

  const totalPages = Math.ceil(total / 10) || 1;

  // Local calendar date as YYYY-MM-DD — NOT new Date().toISOString(), which
  // converts to UTC first and can land on the wrong day depending on the
  // browser's timezone and time of day. due_date is a plain DATE with no
  // time component, so comparing it against the viewer's own local "today"
  // is what actually matches what they'd expect to see.
  function todayLocalDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isOverdue(loan) {
    return loan.status === 'issued' && loan.due_date && loan.due_date < todayLocalDate();
  }

  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Loans</h1>
        {user.role === 'librarian' && (
          <button onClick={handleExport}>Export Issued Loans (CSV)</button>
        )}
      </div>

      {notice && (
        <div className={`notice-banner ${notice.type === 'success' ? 'notice-success' : 'notice-error'}`}>
          {notice.message}
        </div>
      )}

      <div className="filters-bar">
        <input
          placeholder="Search item or borrower..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />

        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="requested">Requested</option>
          <option value="issued">Issued</option>
          <option value="returned">Returned</option>
          <option value="lost">Lost</option>
        </select>

        <select
          value={itemFilter}
          onChange={(e) => { setItemFilter(e.target.value); setPage(1); }}
        >
          <option value="">All items</option>
          {itemOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} ({item.code})
            </option>
          ))}
        </select>

        {user.role === 'librarian' && (
          <select
            value={borrowerFilter}
            onChange={(e) => { setBorrowerFilter(e.target.value); setPage(1); }}
          >
            <option value="">All borrowers</option>
            {borrowerOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        )}

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="requested_at">Sort: Requested date</option>
          <option value="due_date">Sort: Due date</option>
          <option value="status">Sort: Status</option>
        </select>

        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>

      {user.role === 'librarian' && selectedIds.length > 0 && (
        <div className="bulk-bar">
          <span>{selectedIds.length} loan(s) selected</span>
          <button onClick={handleBulkReturn} disabled={bulkProcessing}>
            {bulkProcessing ? 'Processing...' : 'Return Selected'}
          </button>
        </div>
      )}

      {bulkResult && (
        <div className="import-result">
          <p>
            Processed {bulkResult.total} loan(s): {bulkResult.succeeded} succeeded, {bulkResult.failed} failed.
          </p>
          <ul>
            {bulkResult.results
              .filter((r) => !r.success)
              .map((r) => (
                <li key={r.loan_id} className="error-text">
                  Loan {r.loan_id.slice(0, 8)}...: {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p>Loading loans...</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                {user.role === 'librarian' && <th></th>}
                <th>Item</th>
                <th>Borrower</th>
                <th>Status</th>
                <th>Due Date</th>
                {user.role === 'librarian' && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.id}>
                  {user.role === 'librarian' && (
                    <td>
                      {loan.status === 'issued' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(loan.id)}
                          onChange={() => toggleSelect(loan.id)}
                        />
                      )}
                    </td>
                  )}
                  <td>
                    <Link to={`/loans/${loan.id}`} className="link-styled">
                      {loan.item_title} ({loan.item_code})
                    </Link>
                  </td>
                  <td>{loan.borrower_name}</td>
                  <td>
                    {loan.status}
                    {isOverdue(loan) && <span className="badge-overdue"> OVERDUE</span>}
                  </td>
                  <td>{loan.due_date || '—'}</td>

                  {user.role === 'librarian' && (
                    <td>
                      {loan.status === 'requested' && issuingLoanId !== loan.id && (
                        <button onClick={() => setIssuingLoanId(loan.id)}>Issue</button>
                      )}

                      {issuingLoanId === loan.id && (
                        <span>
                          <input
                            type="date"
                            value={dueDateInput}
                            min={todayLocalDate()}
                            onChange={(e) => setDueDateInput(e.target.value)}
                          />
                          <button
                            onClick={() => handleIssue(loan.id)}
                            disabled={submittingIssueLoanId === loan.id}
                          >
                            {submittingIssueLoanId === loan.id ? 'Issuing...' : 'Confirm'}
                          </button>
                        </span>
                      )}

                      {loan.status === 'issued' && losingLoanId !== loan.id && (
                        <>
                          <button
                            onClick={() => handleReturn(loan.id)}
                            disabled={returningLoanId === loan.id || markingLostLoanId === loan.id}
                          >
                            {returningLoanId === loan.id ? 'Returning...' : 'Return'}
                          </button>
                          <button
                            onClick={() => openLostForm(loan.id)}
                            disabled={returningLoanId === loan.id || markingLostLoanId === loan.id}
                          >
                            Mark Lost
                          </button>
                          <button
                            onClick={() => handleSendReminder(loan.id)}
                            disabled={sendingReminderId === loan.id || getRemainingSeconds(loan.id) > 0}
                            title={
                              getRemainingSeconds(loan.id) > 0
                                ? 'A reminder was already sent recently for this loan'
                                : undefined
                            }
                          >
                            {sendingReminderId === loan.id
                              ? 'Sending...'
                              : getRemainingSeconds(loan.id) > 0
                              ? `Wait ${formatCooldown(getRemainingSeconds(loan.id))}`
                              : 'Send Reminder'}
                          </button>
                        </>
                      )}

                      {losingLoanId === loan.id && (
                        <span>
                          <input
                            type="text"
                            placeholder="Note (optional)"
                            value={lostNoteInput}
                            onChange={(e) => setLostNoteInput(e.target.value)}
                          />
                          <button
                            onClick={() => handleLost(loan.id)}
                            disabled={markingLostLoanId === loan.id}
                          >
                            {markingLostLoanId === loan.id ? 'Marking Lost...' : 'Confirm Lost'}
                          </button>
                          <button onClick={cancelLostForm} disabled={markingLostLoanId === loan.id}>Cancel</button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {loans.length === 0 && <p>No loans found.</p>}

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {totalPages} ({total} total)</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}
