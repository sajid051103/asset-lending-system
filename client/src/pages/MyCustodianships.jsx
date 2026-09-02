import { useEffect, useState } from 'react';
import api from '../api/axios';

export default function MyCustodianships() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadItems() {
      try {
        const response = await api.get('/api/my-custodianships');
        setItems(response.data.items);
      } catch (err) {
        setError('Could not load your custodianships');
      } finally {
        setLoading(false);
      }
    }
    loadItems();
  }, []);

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ padding: '40px' }}>{error}</div>;

  return (
    <div className="page">
      <h1>My Custodianships</h1>
      <p style={{ marginBottom: '20px', color: 'var(--text)' }}>
        Items you are responsible for as a custodian.
      </p>

      {items.length === 0 ? (
        <p>You are not a custodian for any items yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Code</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{item.category}</td>
                <td>{item.code}</td>
                <td>{item.is_archived ? 'Archived' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}