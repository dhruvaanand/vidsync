import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className="boot-error">
      <h1>Vidsync failed to start</h1>
      <p>{message}</p>
    </div>
  );
}

if (!window.vidsync) {
  createRoot(container).render(
    <BootScreen message="Preload script did not load. Close all Vidsync windows and run npm start again." />,
  );
} else {
  createRoot(container).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
