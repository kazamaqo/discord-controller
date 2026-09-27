import { Component, type ReactNode } from "react";

type State = { error: Error | null };

// Shows a readable recovery screen instead of a black page when anything throws.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Dashboard crashed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4 text-center">
          <h1 className="text-lg font-semibold">Dashboard hit an error</h1>
          <p className="text-sm text-muted-foreground font-mono break-words">{this.state.error.message}</p>
          <div className="flex gap-2 justify-center">
            <button className="px-4 py-2 rounded-md border border-border" onClick={() => { this.setState({ error: null }); }}>Try again</button>
            <button className="px-4 py-2 rounded-md border border-border" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
