import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || 'Something went wrong logging in';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card-inner">
          <h1>Asset Lending</h1>
          <p className="auth-subtitle">—  Sign-In Card —</p>

          <form onSubmit={handleSubmit}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            {error && <p className="error-text">✕ {error}</p>}

            <button type="submit" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <p className="auth-switch">
            New here? <Link to="/signup">Create an account</Link>
          </p>
        </div>
      </div>

      {/* Separate box below the login card — demo credentials for
          reviewers/testers, kept visually distinct from the sign-in form. */}
      <div
        className="demo-credentials-box"
        style={{
          maxWidth: '420px',
          margin: '20px auto 0',
          padding: '16px 20px',
          border: '1px solid #c9a876',
          borderRadius: '8px',
          background: '#fdfaf3',
        }}
      >
        <p style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>
          Demo Accounts
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid #c9a876' }}>Role</th>
              <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid #c9a876' }}>Email</th>
              <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid #c9a876' }}>Password</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '6px 0' }}>Librarian</td>
              <td style={{ padding: '6px 0' }}>librarian1@test.com</td>
              <td style={{ padding: '6px 0' }}>password123</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0' }}>Member</td>
              <td style={{ padding: '6px 0' }}>member1@test.com</td>
              <td style={{ padding: '6px 0' }}>password123</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}