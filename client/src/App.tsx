import { useEffect, useState } from 'react';
import type { HealthCheckResponse } from '@ai-agent-storefront/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function App() {
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => res.json())
      .then((data: HealthCheckResponse) => setHealth(data))
      .catch(() => setError('Could not reach the server.'));
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-slate-900">
      <h1 className="text-3xl font-bold">AI Agent Storefront</h1>
      {error && <p className="text-red-600">{error}</p>}
      {!error && !health && <p className="text-slate-500">Checking server health...</p>}
      {health && (
        <p className="rounded-md bg-green-100 px-4 py-2 text-green-800">
          Server status: {health.status} (as of {new Date(health.timestamp).toLocaleTimeString()})
        </p>
      )}
    </div>
  );
}

export default App;
