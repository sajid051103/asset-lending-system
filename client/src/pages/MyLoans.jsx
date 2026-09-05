import { useEffect, useState } from 'react';
import api from '../api/axios';

export default function MyLoans() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sortBy, setSortBy] = useState('requested_at');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    async function loadLoans() {
      setLoading(true);
      try {
        // The backend already restricts this to "my own loans" for members
        const response = await api.get('/api/loans', { params: { sortBy, sortOrder } });
        setLoans(response.data.loans);
      } catch (err) {
        setError('Could not load your loans');
      } finally {
        setLoading(false);
      }
    }
    loadLoans();
  }, [sortBy, sortOrder]);

  // Local calendar date as YYYY-MM-DD — NOT new Date().toISOString(), which
  // converts to UTC first and can land on the wrong day depending on the
  // browser's timezone and time of day. See same fix in Loans.jsx.
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

  // Clicking a sortable header: same column -> flip direction, new column -> start ascending
  function handleSort(column) {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  }

  // Backend only supports sorting by these three columns (see allowedSortColumns
  // in loans.js) — item title isn't wired up on the server, so that header
  // stays plain text instead of pretending to sort.
  function SortableHeader({ column, label }) {
    const isActive = sortBy === column;
    return (
      <th
        onClick={() => handleSort(column)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {label}
        <span style={{ marginLeft: '4px', color: isActive ? '#000' : '#bbb' }}>
          {isActive ? (sortOrder === 'asc' ? '▲' : '▼') : '▲▼'}
        </span>
      </th>
    );
  }

  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Loans</h1>
      </div>

      {loading ? (
        <p>Loading your loans...</p>
      ) : loans.length === 0 ? (
        <p>You haven't requested any items yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <SortableHeader column="status" label="Status" />
              <SortableHeader column="requested_at" label="Requested" />
              <SortableHeader column="due_date" label="Due Date" />
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