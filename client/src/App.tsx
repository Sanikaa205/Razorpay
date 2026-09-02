import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/dashboard/Onboarding';
import Catalog from './pages/dashboard/Catalog';
import SafetySettings from './pages/dashboard/SafetySettings';
import LiveOrders from './pages/dashboard/LiveOrders';
import Payments from './pages/dashboard/Payments';
import StoreAiTest from './pages/dashboard/StoreAiTest';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard/onboarding" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="onboarding" replace />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="safety-settings" element={<SafetySettings />} />
          <Route path="orders" element={<LiveOrders />} />
          <Route path="payments" element={<Payments />} />
          <Route path="store-ai-test" element={<StoreAiTest />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
