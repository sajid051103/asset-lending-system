import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';

// Human-readable label + icon-ish prefix for each event type in the timeline.
// 'note' covers system notes (e.g. "Reminder email sent to borrower") as well
// as any free-text note a librarian leaves on an action.
const EVENT_LABELS = {
  requested: 'Requested',
  issued: 'Issued',
  returned: 'Returned',
  lost: 'Marked Lost',
  note: 'Note',
};

function formatDateTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function LoanDetail() {
  const { id } = useParams();

  const [loan, setLoan] = useState(null);
  const [events, setEvents] = useState([]);
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadLoan() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/api/loans/${id}`);
      setLoan(response.data.loan);
      setEvents(response.data.events);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this loan');
    } finally {
      setLoading(false);
    }
  }

  async function loadFees() {
    try {
      const response = await api.get(`/api/loans/${id}/fees`);
      setFees(response.data.fees);
    } catch (err) {
      // Non-fatal — the rest of the page still works without this list
      // (e.g. a member viewing a loan with no fees, or the request racing
      // the loan fetch's own error state).
    }
  }

  useEffect(() => {
    loadLoan();
    loadFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function isOverdue() {
    return (
      loan &&
      loan.status === 'issued' &&
      loan.due_date &&
      loan.due_date < new Date().toISOString().slice(0, 10)
    );
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading loan...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;
  if (!loan) return null;

  return (
    <div className="page">
      <Link to="/loans" className="link-styled back-link">
        &larr; Back to Loans
      </Link>

      <div className="item-header">
        <h1>
          {loan.item_title} <span style={{ fontWeight: 400 }}>({loan.item_code})</span>
        </h1>
        <span className={`status-badge status-${loan.status}`}>
          {loan.status}
          {isOverdue() && <span className="badge-overdue"> OVERDUE</span>}
        </span>
      </div>

      <table className="data-table" style={{ marginBottom: '32px' }}>
        <tbody>
          <tr>
            <td><strong>Borrower</strong></td>
            <td>{loan.borrower_name}{loan.borrower_email ? ` (${loan.borrower_email})` : ''}</td>
          </tr>
          <tr>
            <td><strong>Requested</strong></td>
            <td>{formatDateTime(loan.requested_at)}</td>
          </tr>
          <tr>
            <td><strong>Due Date</strong></td>
            <td>{loan.due_date || '—'}</td>
          </tr>
          <tr>
            <td><strong>Returned</strong></td>
            <td>{formatDateTime(loan.returned_at)}</td>
          </tr>
        </tbody>
      </table>

      {fees.length > 0 && (
        <>
          <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Fees</h2>
          <table className="data-table" style={{ marginBottom: '32px' }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Charged</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((fee) => (
                <tr key={fee.id}>
                  <td style={{ textTransform: 'capitalize' }}>{fee.fee_type}</td>
                  <td>${Number(fee.amount).toFixed(2)}</td>
                  <td>{formatDateTime(fee.created_at)}</td>
                  <td>{fee.waived ? 'Waived' : 'Outstanding'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ fontSize: '18px', marginBottom: '12px' }}>Timeline</h2>

      {events.length === 0 ? (
        <p>No history recorded for this loan yet.</p>
      ) : (
        <ul className="timeline">
          {events.map((event) => (
            <li key={event.id} className="timeline-entry">
              <div className="timeline-entry-header">
                <span className="timeline-entry-label">{EVENT_LABELS[event.event_type] || event.event_type}</span>
                <span className="timeline-entry-date">{formatDateTime(event.created_at)}</span>
              </div>
              <div className="timeline-entry-actor">by {event.actor_name}</div>
              {event.note && <div className="timeline-entry-note">"{event.note}"</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}