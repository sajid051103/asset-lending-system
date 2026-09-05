import { useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const POLL_INTERVAL_MS = 60_000;

// Every possible loan status — used to zero-fill the status breakdown so a
// status with zero loans still shows a row instead of quietly disappearing.
const LOAN_STATUSES = ['requested', 'issued', 'returned', 'lost'];

// Monday of the week containing `date`, matching Postgres's
// date_trunc('week', ...) (ISO weeks start on Monday).
function getMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

// The last `n` week-start dates (oldest first), ending with the current week —
// same range the backend's "last 8 weeks" query covers.
function getLastNWeekStarts(n) {
  const currentMonday = getMonday(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(currentMonday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(formatDate(d));
  }
  return weeks;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [myLimit, setMyLimit] = useState(null); // { activeCount, limit, atLimit }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isFirstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        // For members, also pull their active-loan limit alongside the
        // dashboard fetch, from the same endpoint Catalogue.jsx and
        // ItemDetail.jsx use — one call, and the limit itself comes from
        // the backend instead of being hardcoded here.
        const requests = [api.get('/api/dashboard')];
        if (user.role === 'member') {
          requests.push(api.get('/api/loans/my-limit'));
        }

        const responses = await Promise.all(requests);
        if (cancelled) return;

        setData(responses[0].data);
        if (user.role === 'member') {
          setMyLimit(responses[1].data);
        }
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError('Could not load dashboard');
      } finally {
        if (cancelled) return;
        if (isFirstLoad.current) {
          setLoading(false);
          isFirstLoad.current = false;
        }
      }
    }

    loadDashboard();
    const intervalId = setInterval(loadDashboard, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  if (loading) return <div style={{ padding: '40px' }}>Loading dashboard...</div>;
  // Only show the full error state if we have no data to fall back on —
  // a failed background poll (every 60s) shouldn't wipe an already-loaded
  // dashboard, it should just leave the last good data on screen.
  if (error && !data) return <div style={{ padding: '40px' }}>{error}</div>;

  const { headline, statusBreakdown, custodianBreakdown, weeklyReturns, mostBorrowed } = data;

  // Zero-fill the status breakdown so every status has a row, even at count 0,
  // instead of the backend's GROUP BY silently omitting statuses with no loans.
  const countsByStatus = Object.fromEntries(statusBreakdown.map((r) => [r.status, r.count]));
  const filledStatusBreakdown = LOAN_STATUSES.map((status) => ({
    status,
    count: countsByStatus[status] || 0,
  }));
  const hasAnyStatusData = filledStatusBreakdown.some((r) => r.count > 0);

  // Zero-fill the weekly returns chart so it always shows exactly 8 bars,
  // even for weeks with no returns, instead of only showing weeks that
  // happened to have at least one row in the backend's GROUP BY.
  const countsByWeek = Object.fromEntries(weeklyReturns.map((w) => [w.weekStart, w.count]));
  const filledWeeklyReturns = getLastNWeekStarts(8).map((weekStart) => ({
    weekStart,
    count: countsByWeek[weekStart] || 0,
  }));
  const hasAnyWeeklyData = filledWeeklyReturns.some((w) => w.count > 0);

  // Find the max weekly count so bar heights scale proportionally
  const maxWeeklyCount = Math.max(...filledWeeklyReturns.map((w) => w.count), 1);

  return (
    <div className="page">
      <h1>Welcome, {user.name}</h1>

      {/* Headline numbers — visible to everyone */}
      <div className="stat-grid">
        {user.role === 'member' && myLimit && (
          <div className={`stat-card ${myLimit.atLimit ? 'stat-overdue' : ''}`}>
            <span className="stat-number">
              {myLimit.activeCount} / {myLimit.limit}
            </span>
            <span className="stat-label">Your Active Loans</span>
          </div>
        )}
        <div className="stat-card">
          <span className="stat-number">{headline.itemsOut}</span>
          <span className="stat-label">Items Currently Out</span>
        </div>
        <div className="stat-card stat-overdue">
          <span className="stat-number">{headline.itemsOverdue}</span>
          <span className="stat-label">Items Overdue</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{headline.returnedThisWeek}</span>
          <span className="stat-label">Returned This Week</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{headline.totalItems}</span>
          <span className="stat-label">Total Catalogue Items</span>
        </div>
      </div>

      {/* Breakdown panels — librarian only. Operational data (who's 
          responsible for what, system-wide status counts) is more 
          relevant to librarians managing the catalogue than to 
          members, who only need their own headline numbers. */}
      {user.role === 'librarian' && (
        <div className="dashboard-grid">
          <div className="dashboard-panel">
            <h2>Loans by Status</h2>
            {!hasAnyStatusData ? (
              <p>No loans yet.</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {filledStatusBreakdown.map((row) => (
                    <tr key={row.status}>
                      <td style={{ textTransform: 'capitalize' }}>{row.status}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="dashboard-panel">
            <h2>Items by Custodian</h2>
            {custodianBreakdown.length === 0 ? (
              <p>No custodians assigned yet.</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {custodianBreakdown.map((row) => (
                    <tr key={row.librarian_id}>
                      <td>{row.librarian_name}</td>
                      <td>{row.itemCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="dashboard-panel dashboard-panel-wide">
            <h2>Most Borrowed Items</h2>
            {mostBorrowed.length === 0 ? (
              <p>No loans recorded yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Times Borrowed</th>
                  </tr>
                </thead>
                <tbody>
                  {mostBorrowed.map((row) => (
                    <tr key={row.itemId}>
                      <td>{row.title}</td>
                      <td>{row.borrowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="dashboard-panel dashboard-panel-wide">
            <h2>Items Returned — Last 8 Weeks</h2>
            {!hasAnyWeeklyData ? (
              <p>No returns recorded in the last 8 weeks.</p>
            ) : (
              <div className="bar-chart">
                {filledWeeklyReturns.map((week) => (
                  <div key={week.weekStart} className="bar-chart-column">
                    <div
                      className="bar-chart-bar"
                      style={{ height: `${(week.count / maxWeeklyCount) * 100}%` }}
                      title={`${week.count} returns`}
                    />
                    <span className="bar-chart-value">{week.count}</span>
                    <span className="bar-chart-label">{week.weekStart}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}