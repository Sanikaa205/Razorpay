import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

const NAV_ITEMS = [
  { to: '/dashboard/onboarding', label: 'Onboarding' },
  { to: '/dashboard/catalog', label: 'Catalog' },
  { to: '/dashboard/safety-settings', label: 'Safety Settings' },
  { to: '/dashboard/orders', label: 'Live Orders & Audit Trail' },
  { to: '/dashboard/payments', label: 'Payments' },
];

export default function DashboardLayout() {
  const { merchant, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-5">
          <p className="text-lg font-bold text-slate-900">AI Agent Storefront</p>
          <p className="mt-1 truncate text-sm text-slate-500">{merchant?.name}</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            onClick={() => logout()}
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
