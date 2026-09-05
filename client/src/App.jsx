
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Alerts from './pages/Alerts';
import Login from './pages/Login';
import Catalogue from './pages/Catalogue';
import Navbar from './components/Navbar';
import Loans from './pages/Loans';
import Dashboard from './pages/Dashboard';
import MyCustodianships from './pages/MyCustodianships';
import MyLoans from './pages/MyLoans';
import ItemDetail from './pages/ItemDetail';
import LoanDetail from './pages/LoanDetail';
import Signup from './pages/Signup';
import CreateLibrarian from './pages/CreateLibrarian';
import './App.css';

// Wrapper that blocks access if not logged in
function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LibrarianRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'librarian') return <Navigate to="/dashboard" replace />;
  return children;
}

// Temporary placeholders — we'll replace these with real pages one at a time
function DashboardPlaceholder() {
  const { user } = useAuth();
  return (
    <div style={{ padding: '40px' }}>
      <h1>Welcome, {user.name}</h1>
      <p>Role: {user.role}</p>
    </div>
  );
}

function PagePlaceholder({ title }) {
  return (
    <div style={{ padding: '40px' }}>
      <h1>{title}</h1>
      <p>This page is coming soon.</p>
    </div>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <>
      <Navbar />
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" replace /> : <Login />}
        />

<Route
  path="/signup"
  element={user ? <Navigate to="/dashboard" replace /> : <Signup />}
/>
<Route
  path="/create-librarian"
  element={
    <LibrarianRoute>
      <CreateLibrarian />
    </LibrarianRoute>
  }
/>
     <Route
  path="/dashboard"
  element={
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  }
/>

        <Route
          path="/catalogue"
          element={
            <ProtectedRoute>
              <Catalogue />
            </ProtectedRoute>
          }
        />

        <Route
  path="/loans"
  element={
    <ProtectedRoute>
      <Loans />
    </ProtectedRoute>
  }
/>
<Route
  path="/items/:id"
  element={
    <ProtectedRoute>
      <ItemDetail />
    </ProtectedRoute>
  }
/>

<Route
  path="/loans/:id"
  element={
    <ProtectedRoute>
      <LoanDetail />
    </ProtectedRoute>
  }
/>

       <Route
  path="/alerts"
  element={
    <ProtectedRoute>
      <Alerts />
    </ProtectedRoute>
  }
/>
<Route
  path="/my-custodianships"
  element={
    <ProtectedRoute>
      <MyCustodianships />
    </ProtectedRoute>
  }
/>

        <Route
  path="/my-loans"
  element={
    <ProtectedRoute>
      <MyLoans />
    </ProtectedRoute>
  }
/>

        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
