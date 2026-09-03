import { useEffect, useState } from 'react';
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
  const [sortBy, setSortBy] = useState('requested_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  // per-row issue action
  const [issuingLoanId, setIssuingLoanId] = useState(null);
  const [dueDateInput, setDueDateInput] = useState('');

  // bulk return
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // send-reminder feedback — uses the app's existing notice-banner style
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', message: string }
  const [sendingReminderId, setSendingReminderId] = useState(null);

  async function loadLoans() {
    setLoading(true);
    try {
      const params = { search, status, sortBy, sortOrder, page, limit: 10 };
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
  }, [search, status, sortBy, sortOrder, page]);

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
    try {
      await api.patch(`/api/loans/${loanId}/issue`, { due_date: dueDateInput });
      setIssuingLoanId(null);
      setDueDateInput('');
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not issue this loan');
    }
  }

  async function handleReturn(loanId) {
    try {
      await api.patch(`/api/loans/${loanId}/return`, {});
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not process the return');
    }
  }

  async function handleLost(loanId) {
    const note = window.prompt('Note (optional):') || '';
    try {
      await api.patch(`/api/loans/${loanId}/lost`, { note });
      loadLoans();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not mark this loan as lost');
    }
  }

  async function handleSendReminder(loanId) {
    setSendingReminderId(loanId);
    setNotice(null);
    try {
      await api.post(`/api/loans/${loanId}/send-reminder`, {});
      setNotice({ type: 'success', message: 'Reminder email sent to the borrower.' });
    } catch (err) {
      setNotice({
        type: 'error',
        message: err.response?.data?.error || 'Could not send the reminder email.',
      });
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

  function isOverdue(loan) {
    return loan.status === 'issued' && loan.due_date && loan.due_date < new Date().toISOString().slice(0, 10);
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
                  <td>{loan.item_title} ({loan.item_code})</td>
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
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setDueDateInput(e.target.value)}
                          />
                          <button onClick={() => handleIssue(loan.id)}>Confirm</button>
                        </span>
                      )}

                      {loan.status === 'issued' && (
                        <>
                          <button onClick={() => handleReturn(loan.id)}>Return</button>
                          <button onClick={() => handleLost(loan.id)}>Mark Lost</button>
                          <button
                            onClick={() => handleSendReminder(loan.id)}
                            disabled={sendingReminderId === loan.id}
                          >
                            {sendingReminderId === loan.id ? 'Sending...' : 'Send Reminder'}
                          </button>
                        </>
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