import { useEffect, useState } from 'react';
import api from '../api/axios';

export default function MyLoans() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadLoans() {
      try {
        // The backend already restricts this to "my own loans" for members
        const response = await api.get('/api/loans');
        setLoans(response.data.loans);
      } catch (err) {
        setError('Could not load your loans');
      } finally {
        setLoading(false);
      }
    }
    loadLoans();
  }, []);

  function isOverdue(loan) {
    return loan.status === 'issued' && loan.due_date && loan.due_date < new Date().toISOString().slice(0, 10);
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading your loans...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <h1>My Loans</h1>

      {loans.length === 0 ? (
        <p>You haven't requested any items yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Due Date</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => (
              <tr key={loan.id}>
                <td>{loan.item_title} ({loan.item_code})</td>
                <td>
                  {loan.status}
                  {isOverdue(loan) && <span className="badge-overdue"> OVERDUE</span>}
                </td>
                <td>{loan.requested_at?.slice(0, 10)}</td>
                <td>{loan.due_date || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}