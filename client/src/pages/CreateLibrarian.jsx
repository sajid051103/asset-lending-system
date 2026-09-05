import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

export default function CreateLibrarian() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  function showNotice(type, text) {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    try {
      await api.post('/api/auth/create-librarian', { name, email, password });
      setName('');
      setEmail('');
      setPassword('');
      showNotice('success', 'Librarian account created successfully.');
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Could not create the librarian account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <Link to="/dashboard" className="link-styled back-link">
        &larr; Back to Dashboard
      </Link>
      <h1>Create Librarian</h1>

      {notice && (
        <div className={`notice-banner notice-${notice.type}`}>
          {notice.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="inline-form">
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Librarian'}
        </button>
      </form>
    </div>
  );
}
