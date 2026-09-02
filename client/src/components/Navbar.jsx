import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (user?.role === 'librarian') {
      loadAlertCount();
    }
    // Reload the count whenever we navigate — catches dismissals made on the Alerts page
  }, [user, location]);

  async function loadAlertCount() {
    try {
      const response = await api.get('/api/alerts');
      setAlertCount(response.data.count);
    } catch (err) {
      // silently ignore — badge just won't update
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (!user) return null; // don't show navbar on login page

  return (
    <nav className="navbar">
      <div className="navbar-brand">Asset Lending</div>

      <div className="navbar-links">
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/catalogue">Catalogue</Link>

        {user.role === 'librarian' && (
          <>
            <Link to="/loans">Loans</Link>
            <Link to="/alerts">
              Alerts {alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
            </Link>
            <Link to="/my-custodianships">My Custodianships</Link>
          </>
        )}

        {user.role === 'member' && <Link to="/my-loans">My Loans</Link>}
      </div>

      <div className="navbar-user">
        <span>{user.name} ({user.role})</span>
        <button onClick={handleLogout}>Logout</button>
      </div>
    </nav>
  );
}