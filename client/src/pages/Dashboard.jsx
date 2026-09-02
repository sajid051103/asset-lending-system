import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await api.get('/api/dashboard');
        setData(response.data);
      } catch (err) {
        setError('Could not load dashboard');
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  if (loading) return <div style={{ padding: '40px' }}>Loading dashboard...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  const { headline, statusBreakdown, custodianBreakdown, weeklyReturns } = data;

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