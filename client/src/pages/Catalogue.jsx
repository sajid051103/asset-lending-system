import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function Catalogue() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Search now goes to the backend (see loadItems) instead of filtering
  // client-side, so it matches across the whole catalogue rather than
  // just whatever page happens to be loaded.
  const [search, setSearch] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  const [csvFile, setCsvFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  // Edit state
  const [editingItemId, setEditingItemId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editError, setEditError] = useState('');
  const [savingItemId, setSavingItemId] = useState(null);
  const [archivingItemId, setArchivingItemId] = useState(null);
  const [restoringItemId, setRestoringItemId] = useState(null);

  // STRETCH: per-member borrowing limit — read from GET /api/loans/my-limit
  // instead of hardcoding MAX_ACTIVE_LOANS_PER_MEMBER here, so the frontend
  // never drifts out of sync with the backend's actual limit. Member-only;
  // librarians don't have a personal borrowing cap.
  const [myLimit, setMyLimit] = useState(null); // { activeCount, limit, atLimit }
  const [requestingItemId, setRequestingItemId] = useState(null);

  // Replaces browser alert() with an inline banner message
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text: '...' }

  function showNotice(type, text) {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  }

  async function loadItems() {
    setLoading(true);
    try {
      const response = await api.get('/api/items', {
        params: {
          ...(showArchived ? { includeArchived: 'true' } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          page,
          limit: 20,
        },
      });
      setItems(response.data.items);
      setTotal(response.data.total);
    } catch (err) {
      setError('Could not load catalogue items');
    } finally {
      setLoading(false);
    }
  }

  async function loadMyLimit() {
    try {
      const response = await api.get('/api/loans/my-limit');
      setMyLimit(response.data);
    } catch (err) {
      // Non-fatal — if this fails the Request button just falls back to
      // relying on the backend's 409, same as before this feature existed.
    }
  }

  // Debounce the search box so we're not firing a request on every
  // keystroke — waits 300ms after the user stops typing, and resets to
  // page 1 since the result set has changed.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      loadItems();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, page]);

  useEffect(() => {
    if (user.role === 'member') {
      loadMyLimit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggling "show archived" changes the underlying result set, so jumping
  // back to page 1 avoids landing on a now-out-of-range page.
  function handleToggleArchived(checked) {
    setShowArchived(checked);
    setPage(1);
  }

  async function handleAddItem(e) {
    e.preventDefault();
    setFormError('');
    setAddingItem(true);
    try {
      await api.post('/api/items', { title, category, code });
      setTitle('');
      setCategory('');
      setCode('');
      setShowAddForm(false);
      loadItems();
      showNotice('success', `"${title}" added to the catalogue.`);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Something went wrong adding the item');
    } finally {
      setAddingItem(false);
    }
  }

  async function handleCsvImport(e) {
    e.preventDefault();
    if (!csvFile) {
      showNotice('error', 'Please choose a CSV file first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', csvFile);

    setImporting(true);
    setImportResult(null);
    try {
      const response = await api.post('/api/bulk/items-import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(response.data);
      setCsvFile(null);
      loadItems();
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Something went wrong importing the CSV.');
    } finally {
      setImporting(false);
    }
  }

  async function handleRequest(itemId, itemTitle) {
    // Belt-and-braces: the button is already disabled at the cap, but a
    // stale myLimit (e.g. two tabs open) could let a click through — the
    // backend's 409 is still the real guard, this just avoids a pointless
    // round trip when we already know it'll fail.
    if (myLimit?.atLimit) {
      showNotice(
        'error',
        `You already have ${myLimit.activeCount} active loans (limit is ${myLimit.limit}). Return an item before requesting another.`
      );
      return;
    }

    setRequestingItemId(itemId);
    try {
      await api.post('/api/loans', { item_id: itemId });
      showNotice('success', `Requested "${itemTitle}" successfully.`);
      loadMyLimit(); // the count just went up by one
      loadItems(); // refresh so has_open_loan flips and the Request button disappears
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Could not request this item.');
      // The backend rejected it (e.g. someone else's request landed first,
      // or the count was stale) — refresh so the button reflects reality.
      loadMyLimit();
      loadItems();
    } finally {
      setRequestingItemId(null);
    }
  }

  async function handleArchive(itemId) {
    setArchivingItemId(itemId);
    try {
      await api.patch(`/api/items/${itemId}/archive`);
      loadItems();
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Could not archive this item.');
    } finally {
      setArchivingItemId(null);
    }
  }

  async function handleRestore(itemId) {
    setRestoringItemId(itemId);
    try {
      await api.patch(`/api/items/${itemId}/restore`);
      loadItems();
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Could not restore this item.');
    } finally {
      setRestoringItemId(null);
    }
  }

  function startEdit(item) {
    setEditingItemId(item.id);
    setEditTitle(item.title);
    setEditCategory(item.category);
    setEditCode(item.code);
    setEditError('');
  }

  function cancelEdit() {
    setEditingItemId(null);
    setEditError('');
  }

  async function handleSaveEdit(itemId) {
    setEditError('');
    setSavingItemId(itemId);
    try {
      await api.patch(`/api/items/${itemId}`, {
        title: editTitle,
        category: editCategory,
        code: editCode,
      });
      setEditingItemId(null);
      loadItems();
      showNotice('success', 'Item updated successfully.');
    } catch (err) {
      setEditError(err.response?.data?.error || 'Could not update this item');
    } finally {
      setSavingItemId(null);
    }
  }

  const totalPages = Math.max(Math.ceil(total / 20), 1);

  if (loading) return <div className="loading-state">Loading catalogue...</div>;
  if (error) return <div className="loading-state">{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Catalogue</h1>
        {user.role === 'librarian' && (
          <button onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add Item'}
          </button>
        )}
      </div>

      {/* FIX: Add Item form now opens right under the header/+Add Item
          button, not further down after the filters bar — so clicking
          the button visibly opens the form right where you clicked. */}
      {showAddForm && (
        <form onSubmit={handleAddItem} className="inline-form">
          <input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <input
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
          <input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button type="submit" disabled={addingItem}>
            {addingItem ? 'Adding...' : 'Save'}
          </button>
          {formError && <p className="error-text">{formError}</p>}
        </form>
      )}

      {notice && (
        <div className={`notice-banner notice-${notice.type}`}>
          {notice.text}
        </div>
      )}

      {user.role === 'member' && myLimit && (
        <div className={`notice-banner ${myLimit.atLimit ? 'notice-error' : 'notice-info'}`}>
          {myLimit.atLimit
            ? `You have ${myLimit.activeCount} of ${myLimit.limit} active loans — you're at your limit. Return an item before requesting another.`
            : `You have ${myLimit.activeCount} of ${myLimit.limit} active loans.`}
        </div>
      )}

      {/* FIX: removed space-between so search + archive-toggle sit close
          together with a fixed gap, instead of being pushed to opposite
          ends of the row. flexWrap keeps it tidy on narrow screens. */}
      <div
        className="filters-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '16px',
        }}
      >
        <input
          placeholder="Search title, category or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: '260px' }}
        />
        {user.role === 'librarian' && (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: '14px',
              padding: '9px 14px',
              border: '1px solid #c9a876',
              borderRadius: '6px',
              background: showArchived ? '#f0e4cc' : '#fdfaf3',
              cursor: 'pointer',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => handleToggleArchived(e.target.checked)}
              style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
            />
            Show archived items
          </label>
        )}
      </div>

      {user.role === 'librarian' && (
        <form onSubmit={handleCsvImport} className="inline-form" style={{ marginBottom: '20px' }}>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files[0])}
          />
          <button type="submit" disabled={importing}>
            {importing ? 'Importing...' : 'Import CSV'}
          </button>
        </form>
      )}

      {importResult && (
        <div className="import-result">
          <p>
            Imported {importResult.succeeded} of {importResult.total} rows
            {importResult.failed > 0 && ` (${importResult.failed} failed)`}.
          </p>
          <ul>
            {importResult.results
              .filter((r) => !r.success)
              .map((r) => (
                <li key={r.row} className="error-text">
                  Row {r.row}: {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Code</th>
            <th>Status</th>
            {(user.role === 'librarian' || user.role === 'member') && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {editingItemId === item.id ? (
                <>
                  <td>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <span className={`status-badge status-${item.is_archived ? 'archived' : 'active'}`}>
                      {item.is_archived ? 'Archived' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleSaveEdit(item.id)}
                      disabled={savingItemId === item.id}
                    >
                      {savingItemId === item.id ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={cancelEdit} disabled={savingItemId === item.id}>Cancel</button>
                    {editError && <p className="error-text">{editError}</p>}
                  </td>
                </>
              ) : (
                <>
                  <td>
                    <Link to={`/items/${item.id}`} className="link-styled">
                      {item.title}
                    </Link>
                  </td>
                  <td>{item.category}</td>
                  <td>{item.code}</td>
                  <td>
                    <span className={`status-badge status-${item.is_archived ? 'archived' : 'active'}`}>
                      {item.is_archived ? 'Archived' : 'Active'}
                    </span>
                    {/* Availability is separate from archived/active — an
                        active item can still be unavailable because it's
                        currently out on loan. Shown right here so a member
                        never has to open the item or scroll down to find out. */}
                    {!item.is_archived && (
                      <span
                        className={`status-badge ${item.has_open_loan ? 'status-issued' : 'status-active'}`}
                        style={{ marginLeft: '6px' }}
                      >
                        {item.has_open_loan ? 'On Loan' : 'Available'}
                      </span>
                    )}
                  </td>
                  {user.role === 'librarian' && (
                    <td>
                      <button onClick={() => startEdit(item)}>Edit</button>
                      {item.is_archived ? (
                        <button
                          onClick={() => handleRestore(item.id)}
                          disabled={restoringItemId === item.id}
                        >
                          {restoringItemId === item.id ? 'Restoring...' : 'Restore'}
                        </button>
                      ) : (
                        <button
                          className="btn-danger"
                          onClick={() => handleArchive(item.id)}
                          disabled={archivingItemId === item.id}
                        >
                          {archivingItemId === item.id ? 'Archiving...' : 'Archive'}
                        </button>
                      )}
                    </td>
                  )}
                  {user.role === 'member' && (
                    <td>
                      {/* Only show Request when the item is actually
                          requestable — not archived AND no open loan
                          against it already. Otherwise there's nothing to
                          click, instead of a button that always 409s. */}
                      {!item.is_archived && !item.has_open_loan && (
                        <button
                          onClick={() => handleRequest(item.id, item.title)}
                          disabled={myLimit?.atLimit || requestingItemId === item.id}
                          title={myLimit?.atLimit ? `You're at your ${myLimit.limit}-loan limit` : undefined}
                        >
                          {requestingItemId === item.id ? 'Requesting...' : 'Request'}
                        </button>
                      )}
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {items.length === 0 && !search && <p>No items in the catalogue yet.</p>}
      {items.length === 0 && search && <p>No items match "{search}".</p>}

      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {totalPages} ({total} total)</span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}