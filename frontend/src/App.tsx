import { useState } from 'react';
import './App.css';

interface HealthData {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
}

export function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

  const checkBackendHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/health`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data: HealthData = await res.json();
      setHealth(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reach backend';
      setError(message);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand-section">
          <div className="logo-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h20" />
              <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
              <path d="m4 8 16-4" />
              <path d="m16 4-2 4" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">AgentLens</h1>
            <span className="brand-tag">Member 4 — Platform & UI</span>
          </div>
        </div>
        <div className="header-badges">
          <div className="badge">
            <span className="badge-pulse" />
            <span>Foundation Ready</span>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-card">
          <h2 className="hero-title">Platform & Application Foundation</h2>
          <p className="hero-description">
            Clean project foundation configured for AWS serverless architecture (API Gateway, Lambda, DynamoDB) 
            and Amplify-hosted React frontend.
          </p>
        </section>

        <div className="grid-container">
          <div className="card">
            <h3 className="card-title">Backend API Verification</h3>
            <p className="card-subtitle">Test connection to local backend or API Gateway</p>
            
            <button 
              id="test-health-btn"
              className="btn-primary" 
              onClick={checkBackendHealth} 
              disabled={loading}
            >
              {loading ? 'Testing...' : 'Check /health Status'}
            </button>

            {health && (
              <div className="health-status-box" style={{ borderColor: 'var(--accent-emerald)' }}>
                <div className="health-status-row">
                  <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                  <strong style={{ color: 'var(--accent-emerald)' }}>{health.status}</strong>
                </div>
                <div className="health-status-row">
                  <span style={{ color: 'var(--text-muted)' }}>Service:</span>
                  <span>{health.service}</span>
                </div>
                <div className="health-status-row">
                  <span style={{ color: 'var(--text-muted)' }}>Version:</span>
                  <span>{health.version}</span>
                </div>
                <div className="health-status-row">
                  <span style={{ color: 'var(--text-muted)' }}>Env:</span>
                  <span>{health.environment}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="health-status-box" style={{ borderColor: '#ef4444', color: '#f87171' }}>
                <div>Connection Error: {error}</div>
                <div style={{ fontSize: '0.75rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
                  Make sure backend is running on {apiBaseUrl}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">Member 4 Scope</h3>
            <p className="card-subtitle">Platform & UI Foundation Responsibilities</p>
            <ul className="scope-list">
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>AWS application foundation</span>
              </li>
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>API Gateway routing & CORS</span>
              </li>
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>AWS Lambda backend handlers</span>
              </li>
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>DynamoDB data persistence layer</span>
              </li>
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>Amplify CI/CD deployment</span>
              </li>
              <li className="scope-item">
                <span className="scope-bullet" />
                <span>UI for AgentLens workflow</span>
              </li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <span>AgentLens Hackathon Project</span>
        <span>Environment Config: Separated</span>
      </footer>
    </div>
  );
}

export default App;
