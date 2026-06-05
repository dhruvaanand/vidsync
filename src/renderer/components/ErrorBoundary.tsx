import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Vidsync render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error">
          <h1>Something went wrong</h1>
          <p>{this.state.error}</p>
          <p className="boot-hint">
            Try running: <code>npx @electron/rebuild -f -m native/mpv-addon</code>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
