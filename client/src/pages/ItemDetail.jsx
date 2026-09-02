import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';

export default function ItemDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadItem() {
      try {
        const response = await api.get(`/api/items/${id}`);
        setItem(response.data.item);
        setLoans(response.data.loans);
      } catch (err) {
        setError('Could not load item details');
      } finally {
        setLoading(false);
      }
    }
    loadItem();
  }, [id]);

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <Link to="/catalogue">&larr; Back to Catalogue</Link>

      <h1 style={{ marginTop: '16px' }}>{item.title}</h1>
      <p style={{ color: 'var(--text)', marginBottom: '24px' }}>
        {item.category} · {item.code} · {item.is_archived ? 'Archived' : 'Active'}
      </p>

      <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Loan History</h2>

      {loans.length === 0 ? (
        <p>This item has never been loaned out.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Due Date</th>
              <th>Returned</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => (
              <tr key={loan.id}>
                <td>{loan.borrower_name}</td>
                <td style={{ textTransform: 'capitalize' }}>{loan.status}</td>
                <td>{loan.requested_at?.slice(0, 10)}</td>
                <td>{loan.due_date || '—'}</td>
                <td>{loan.returned_at?.slice(0, 10) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}