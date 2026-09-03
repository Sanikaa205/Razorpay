import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/dashboard/Onboarding';
import Catalog from './pages/dashboard/Catalog';
import LiveOrders from './pages/dashboard/LiveOrders';
import Payments from './pages/dashboard/Payments';
import StorefrontChat from './pages/StorefrontChat';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard/onboarding" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/store/:merchantId" element={<StorefrontChat />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="onboarding" replace />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="orders" element={<LiveOrders />} />
          <Route path="payments" element={<Payments />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
