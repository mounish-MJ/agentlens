import { useState, useEffect, useCallback } from 'react';
import { OverviewView } from './components/OverviewView.js';
import { RunsView } from './components/RunsView.js';
import { RunDetailView } from './components/RunDetailView.js';
import { IncidentsView } from './components/IncidentsView.js';
import { apiClient } from './api/client.js';
import type { HealthCheckResponse } from './types/contracts.js';
import './App.css';

type ActiveTab = 'overview' | 'runs' | 'incidents';

function getInitialRoute(): { tab: ActiveTab; runId: string | null } {
  if (typeof window === 'undefined') {
    return { tab: 'overview', runId: null };
  }
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('runs/')) {
    return { tab: 'runs', runId: hash.slice('runs/'.length) };
  } else if (hash === 'runs') {
    return { tab: 'runs', runId: null };
  } else if (hash === 'incidents') {
    return { tab: 'incidents', runId: null };
  }
  return { tab: 'overview', runId: null };
}

export function App() {
  const initial = getInitialRoute();
  const [activeTab, setActiveTab] = useState<ActiveTab>(initial.tab);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initial.runId);

  // Backend Health State
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const data = await apiClient.getHealth();
      setHealth(data);
      setHealthError(null);
    } catch (err: unknown) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Backend unreachable');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Sync state with URL hash for direct deep-linking
  const handleHashChange = useCallback(() => {
    const route = getInitialRoute();
    setActiveTab(route.tab);
    setSelectedRunId(route.runId);
  }, []);

  useEffect(() => {
    void checkHealth();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [checkHealth, handleHashChange]);

  const navigateToTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSelectedRunId(null);
    window.location.hash = tab === 'overview' ? '' : tab;
  };

  const navigateToRunDetail = (runId: string) => {
    setSelectedRunId(runId);
    setActiveTab('runs');
    window.location.hash = `runs/${runId}`;
  };

  const navigateBackToRuns = () => {
    setSelectedRunId(null);
    window.location.hash = 'runs';
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-section" onClick={() => navigateToTab('overview')} role="button" tabIndex={0}>
            <div className="logo-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.3" />
              </svg>
            </div>
            <div>
              <div className="brand-title-row">
                <h1 className="brand-title">AgentLens</h1>
                <span className="brand-badge">OBSERVABILITY</span>
              </div>
              <div className="brand-subtext">AI Reliability & Telemetry Platform</div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="nav-tabs" aria-label="Main Navigation">
            <button
              className={`nav-tab ${activeTab === 'overview' && !selectedRunId ? 'active' : ''}`}
              onClick={() => navigateToTab('overview')}
            >
              Overview
            </button>
            <button
              className={`nav-tab ${activeTab === 'runs' ? 'active' : ''}`}
              onClick={() => navigateToTab('runs')}
            >
              Runs
              {selectedRunId && <span className="nav-sub-indicator">/ Detail</span>}
            </button>
            <button
              className={`nav-tab ${activeTab === 'incidents' ? 'active' : ''}`}
              onClick={() => navigateToTab('incidents')}
            >
              Incidents
            </button>
          </nav>
        </div>

        <div className="header-right">
          {/* Cloud Infrastructure Badge */}
          <div className="cloud-badge" title="AWS Deployed Region">
            <span className="cloud-dot" />
            <span>AWS ap-southeast-2</span>
          </div>

          {/* Health Check Status Pill */}
          <div
            className={`health-pill ${health ? 'health-ok' : healthError ? 'health-err' : 'health-loading'}`}
            onClick={checkHealth}
            role="button"
            tabIndex={0}
            title={health ? `Connected to ${health.service} (${health.table || 'DynamoDB'}). Click to re-check.` : healthError || 'Checking health...'}
          >
            <span className="pulse-indicator" />
            <span>{healthLoading ? 'Checking...' : health ? 'API Online' : 'API Offline'}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {activeTab === 'overview' && (
          <OverviewView
            onSelectRun={navigateToRunDetail}
            onNavigateToRuns={() => navigateToTab('runs')}
            onNavigateToIncidents={() => navigateToTab('incidents')}
          />
        )}

        {activeTab === 'runs' && !selectedRunId && (
          <RunsView onSelectRun={navigateToRunDetail} />
        )}

        {activeTab === 'runs' && selectedRunId && (
          <RunDetailView runId={selectedRunId} onBack={navigateBackToRuns} />
        )}

        {activeTab === 'incidents' && (
          <IncidentsView onSelectRun={navigateToRunDetail} />
        )}
      </main>

      {/* App Footer */}
      <footer className="app-footer">
        <div className="footer-left">
          <span>AgentLens Platform</span>
          <span className="footer-bullet">•</span>
          <span>Member 4 — Platform & UI</span>
          <span className="footer-bullet">•</span>
          <span>Single-Table DynamoDB (<code className="font-mono text-xs">agentlens-data-dev</code>)</span>
        </div>
        <div className="footer-right">
          <span>API: <code className="font-mono text-xs">{apiClient.getBaseUrl()}</code></span>
        </div>
      </footer>
    </div>
  );
}

export default App;
