import { useEffect, useState } from 'react';
import api from '../api/axios';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadAlerts() {
    setLoading(true);
    try {
      const response = await api.get('/api/alerts');
      setAlerts(response.data.alerts);
    } catch (err) {
      setError('Could not load alerts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  async function handleDismiss(loanId) {
    try {
      await api.post(`/api/loans/${loanId}/dismiss-alert`);
      loadAlerts(); // refresh the list — this loan should disappear
    } catch (err) {
      alert(err.response?.data?.error || 'Could not dismiss this alert');
    }
  }

  function daysOverdue(dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    const diffMs = today - due;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading alerts...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <h1>Overdue Alerts {alerts.length > 0 && `(${alerts.length})`}</h1>

      {alerts.length === 0 ? (
        <p>No overdue alerts right now — everything is on track.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Borrower</th>
              <th>Due Date</th>
              <th>Days Overdue</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id}>
                <td>{alert.item_title} ({alert.item_code})</td>
                <td>{alert.borrower_name}</td>
                <td>{alert.due_date}</td>
                <td className="badge-overdue">{daysOverdue(alert.due_date)} days</td>
                <td>
                  <button onClick={() => handleDismiss(alert.id)}>Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}