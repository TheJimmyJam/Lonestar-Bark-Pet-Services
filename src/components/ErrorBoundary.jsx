import { Component } from "react";

// ─── Customer Error Boundary ──────────────────────────────────────────────────
// ─── Customer Error Boundary ──────────────────────────────────────────────────
class CustomerErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", padding: "32px", textAlign: "center",
          fontFamily: "'DM Sans', sans-serif" }}>
          <div>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🐾</div>
            <div style={{ fontSize: "20px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
              Something went wrong.
            </div>
            <div style={{ fontSize: "15px", color: "#6b7280", marginBottom: "24px" }}>
              Please refresh the page and try again.
            </div>
            <button onClick={() => window.location.reload()}
              style={{ padding: "12px 28px", borderRadius: "10px", border: "none",
                background: "#C4541A", color: "#fff", fontSize: "15px",
                fontWeight: 500, cursor: "pointer" }}>
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


export default CustomerErrorBoundary;
