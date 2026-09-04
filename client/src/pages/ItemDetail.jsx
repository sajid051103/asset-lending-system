import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function ItemDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [item, setItem] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // "Create Loan" form state (librarian only)
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loanFormError, setLoanFormError] = useState('');
  const [submittingLoan, setSubmittingLoan] = useState(false);

  // Custodians — everyone can see the list, only librarians can add/remove
  const [custodians, setCustodians] = useState([]);
  const [custodiansLoading, setCustodiansLoading] = useState(true);
  const [showCustodianForm, setShowCustodianForm] = useState(false);
  const [librarians, setLibrarians] = useState([]);
  const [librariansLoading, setLibrariansLoading] = useState(false);
  const [selectedLibrarianId, setSelectedLibrarianId] = useState('');
  const [custodianFormError, setCustodianFormError] = useState('');
  const [submittingCustodian, setSubmittingCustodian] = useState(false);
  const [removingCustodianId, setRemovingCustodianId] = useState(null);

  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text: '...' }

  function showNotice(type, text) {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  }

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

  async function loadCustodians() {
    setCustodiansLoading(true);
    try {
      const response = await api.get(`/api/items/${id}/custodians`);
      setCustodians(response.data.custodians);
    } catch (err) {
      // Non-fatal — the rest of the page still works without this list
    } finally {
      setCustodiansLoading(false);
    }
  }

  useEffect(() => {
    loadItem();
    loadCustodians();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Goal 4: an item can't be issued while it already has an open loan
  // (requested or issued). Compute this from the loans we already have,
  // so we don't need an extra request just to know whether to disable the form.
  const hasOpenLoan = loans.some((loan) => loan.status === 'requested' || loan.status === 'issued');

  async function openLoanForm() {
    setShowLoanForm(true);
    setLoanFormError('');
    if (members.length === 0) {
      setMembersLoading(true);
      try {
        const response = await api.get('/api/users', { params: { role: 'member' } });
        setMembers(response.data.users);
      } catch (err) {
        setLoanFormError('Could not load the member list.');
      } finally {
        setMembersLoading(false);
      }
    }
  }

  function closeLoanForm() {
    setShowLoanForm(false);
    setSelectedMemberId('');
    setDueDate('');
    setLoanFormError('');
  }

  async function handleCreateLoan(e) {
    e.preventDefault();
    setLoanFormError('');

    if (!selectedMemberId) {
      setLoanFormError('Please choose a member.');
      return;
    }
    if (!dueDate) {
      setLoanFormError('Please choose a due date.');
      return;
    }

    setSubmittingLoan(true);
    try {
      await api.post('/api/loans', {
        item_id: id,
        borrower_id: selectedMemberId,
        due_date: dueDate,
      });
      closeLoanForm();
      await loadItem(); // refresh loan history + hasOpenLoan
      showNotice('success', 'Loan issued successfully.');
    } catch (err) {
      setLoanFormError(err.response?.data?.error || 'Could not create this loan.');
    } finally {
      setSubmittingLoan(false);
    }
  }

  // Librarians already assigned as custodians can't be picked again — the
  // backend would 409 anyway, but filtering them out here keeps the
  // dropdown honest and avoids a pointless round trip.
  const custodianIds = new Set(custodians.map((c) => c.id));
  const availableLibrarians = librarians.filter((l) => !custodianIds.has(l.id));

  async function openCustodianForm() {
    setShowCustodianForm(true);
    setCustodianFormError('');
    if (librarians.length === 0) {
      setLibrariansLoading(true);
      try {
        const response = await api.get('/api/users', { params: { role: 'librarian' } });
        setLibrarians(response.data.users);
      } catch (err) {
        setCustodianFormError('Could not load the librarian list.');
      } finally {
        setLibrariansLoading(false);
      }
    }
  }

  function closeCustodianForm() {
    setShowCustodianForm(false);
    setSelectedLibrarianId('');
    setCustodianFormError('');
  }

  async function handleAddCustodian(e) {
    e.preventDefault();
    setCustodianFormError('');

    if (!selectedLibrarianId) {
      setCustodianFormError('Please choose a librarian.');
      return;
    }

    setSubmittingCustodian(true);
    try {
      await api.post(`/api/items/${id}/custodians`, { librarian_id: selectedLibrarianId });
      closeCustodianForm();
      await loadCustodians();
      showNotice('success', 'Custodian added.');
    } catch (err) {
      setCustodianFormError(err.response?.data?.error || 'Could not add this custodian.');
    } finally {
      setSubmittingCustodian(false);
    }
  }

  async function handleRemoveCustodian(librarianId) {
    setRemovingCustodianId(librarianId);
    try {
      await api.delete(`/api/items/${id}/custodians/${librarianId}`);
      await loadCustodians();
      showNotice('success', 'Custodian removed.');
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Could not remove this custodian.');
    } finally {
      setRemovingCustodianId(null);
    }
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <Link to="/catalogue" className="link-styled back-link">
        &larr; Back to Catalogue
      </Link>

      <div className="item-header">
        <h1>{item.title}</h1>
        <span className={`status-badge status-${item.is_archived ? 'archived' : 'active'}`}>
          {item.is_archived ? 'Archived' : 'Active'}
        </span>
      </div>
      <p className="item-subtitle">
        {item.category} &middot; {item.code}
      </p>

      {notice && (
        <div className={`notice-banner notice-${notice.type}`}>
          {notice.text}
        </div>
      )}

      {user.role === 'librarian' && !item.is_archived && (
        <div className="loan-form-card">
          {hasOpenLoan ? (
            <p>
              This item currently has an open loan against it, so a new loan can't be issued
              until it's returned, marked lost, or the request is otherwise resolved.
            </p>
          ) : !showLoanForm ? (
            <button className="btn-primary" onClick={openLoanForm}>
              + Create Loan
            </button>
          ) : (
            <form onSubmit={handleCreateLoan}>
              <div className="loan-form-row">
                <div className="loan-form-field">
                  <label>Borrower</label>
                  {membersLoading ? (
                    <p>Loading members...</p>
                  ) : (
                    <select
                      value={selectedMemberId}
                      onChange={(e) => setSelectedMemberId(e.target.value)}
                    >
                      <option value="">Select a member...</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="loan-form-field">
                  <label>Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              </div>

              <div className="loan-form-actions">
                <button type="submit" disabled={submittingLoan} className="btn-primary">
                  {submittingLoan ? 'Issuing...' : 'Issue Loan'}
                </button>
                <button type="button" onClick={closeLoanForm} className="btn-secondary">
                  Cancel
                </button>
                {loanFormError && <span className="error-text">{loanFormError}</span>}
              </div>
            </form>
          )}
        </div>
      )}

      <div className="item-header" style={{ marginTop: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: 0 }}>Custodians</h2>
        {user.role === 'librarian' && !showCustodianForm && (
          <button className="btn-primary" onClick={openCustodianForm}>
            + Add Custodian
          </button>
        )}
      </div>

      {user.role === 'librarian' && showCustodianForm && (
        <form onSubmit={handleAddCustodian} className="loan-form-card">
          <div className="loan-form-row">
            <div className="loan-form-field">
              <label>Librarian</label>
              {librariansLoading ? (
                <p>Loading librarians...</p>
              ) : (
                <select
                  value={selectedLibrarianId}
                  onChange={(e) => setSelectedLibrarianId(e.target.value)}
                >
                  <option value="">Select a librarian...</option>
                  {availableLibrarians.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.email})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="loan-form-actions">
            <button type="submit" disabled={submittingCustodian} className="btn-primary">
              {submittingCustodian ? 'Adding...' : 'Add'}
            </button>
            <button type="button" onClick={closeCustodianForm} className="btn-secondary">
              Cancel
            </button>
            {custodianFormError && <span className="error-text">{custodianFormError}</span>}
          </div>
        </form>
      )}

      {custodiansLoading ? (
        <p>Loading custodians...</p>
      ) : custodians.length === 0 ? (
        <p>No custodians assigned to this item yet.</p>
      ) : (
        <table className="data-table" style={{ marginBottom: '32px' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              {user.role === 'librarian' && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {custodians.map((custodian) => (
              <tr key={custodian.id}>
                <td>{custodian.name}</td>
                <td>{custodian.email}</td>
                {user.role === 'librarian' && (
                  <td>
                    <button
                      className="btn-danger"
                      onClick={() => handleRemoveCustodian(custodian.id)}
                      disabled={removingCustodianId === custodian.id}
                    >
                      {removingCustodianId === custodian.id ? 'Removing...' : 'Remove'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
                <td>
                  <Link to={`/loans/${loan.id}`} className="link-styled">
                    {loan.borrower_name}
                  </Link>
                </td>
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