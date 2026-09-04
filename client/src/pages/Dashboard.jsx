import { useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const POLL_INTERVAL_MS = 60_000;

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isFirstLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const response = await api.get('/api/dashboard');
        if (cancelled) return;
        setData(response.data);
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

  // Find the max weekly count so bar heights scale proportionally
  const maxWeeklyCount = Math.max(...weeklyReturns.map((w) => w.count), 1);

  return (
    <div className="page">
      <h1>Welcome, {user.name}</h1>

      {/* Headline numbers — visible to everyone */}
      <div className="stat-grid">
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
            {statusBreakdown.length === 0 ? (
              <p>No loans yet.</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {statusBreakdown.map((row) => (
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
            {weeklyReturns.length === 0 ? (
              <p>No returns recorded in the last 8 weeks.</p>
            ) : (
              <div className="bar-chart">
                {weeklyReturns.map((week) => (
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