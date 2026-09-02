import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

export function ProtectedRoute() {
  const { merchant, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  if (!merchant) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
