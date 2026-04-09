import { useState, useEffect } from "react";
import { loadContactSubmissions, updateContactSubmission, deleteContactSubmission } from "../../supabase.js";

// ─── Admin Contact Submissions Tab ───────────────────────────────────────────
function AdminContactTab() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | new | reviewed | archived
  const [expandedId, setExpandedId] = useState(null);
  const [notesDraft, setNotesDraft] = useState("");

  const amber = "#b45309";

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const rows = await loadContactSubmissions();
    setSubmissions(rows);
    setLoading(false);
  };

  const handleStatusChange = async (id, newStatus) => {
    await updateContactSubmission(id, { status: newStatus });
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  };

  const handleSaveNotes = async (id) => {
    await updateContactSubmission(id, { adminNotes: notesDraft });
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, adminNotes: notesDraft } : s));
  };

  const handleDelete = async (id) => {
    await deleteContactSubmission(id);
    setSubmissions(prev => prev.filter(s => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const filtered = filter === "all" ? submissions : submissions.filter(s => s.status === filter);
  const counts = {
    all: submissions.length,
    new: submissions.filter(s => s.status === "new").length,
    reviewed: submissions.filter(s => s.status === "reviewed").length,
    archived: submissions.filter(s => s.status === "archived").length,
  };

  const prefIcon = { email: "📧", text: "💬", cell: "📞" };
  const prefLabel = { email: "Email", text: "Text", cell: "Phone Call" };
  const statusColors = {
    new: { bg: "#FDF5EC", border: "#D4A843", text: "#C4541A" },
    reviewed: { bg: "#f0fdf4", border: "#86efac", text: "#16a34a" },
    archived: { bg: "#f9fafb", border: "#e4e7ec", text: "#9ca3af" },
  };

  const labelStyle = {
    fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700,
    letterSpacing: "1.5px", textTransform: "uppercase", color: "#9ca3af",
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
          Loading submissions...
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ maxWidth: "700px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
          textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, color: "#111827" }}>
          Contact Submissions
          {counts.new > 0 && (
            <span style={{ marginLeft: "10px", background: "#C4541A", color: "#fff",
              borderRadius: "12px", padding: "2px 10px", fontSize: "13px",
              fontWeight: 700, letterSpacing: "0" }}>{counts.new} new</span>
          )}
        </div>
        <button onClick={loadAll} style={{ padding: "7px 14px", borderRadius: "8px",
          border: "1.5px solid #e4e7ec", background: "#f9fafb",
          fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
          color: "#374151", cursor: "pointer" }}>Refresh</button>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
        {["all", "new", "reviewed", "archived"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: "20px",
              border: filter === f ? `1.5px solid ${amber}` : "1.5px solid #e4e7ec",
              background: filter === f ? "#fffbeb" : "#fff",
              color: filter === f ? amber : "#6b7280",
              fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
              fontWeight: filter === f ? 600 : 400, cursor: "pointer",
              textTransform: "capitalize",
            }}>
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
          padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>📨</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#9ca3af" }}>
            {filter === "all" ? "No contact submissions yet." : `No ${filter} submissions.`}
          </div>
        </div>
      )}

      {/* Submission cards */}
      {filtered.map(sub => {
        const expanded = expandedId === sub.id;
        const sc = statusColors[sub.status] || statusColors.new;
        const timeAgo = formatTimeAgo(sub.createdAt);

        return (
          <div key={sub.id} style={{
            background: "#fff", borderRadius: "14px",
            border: `1.5px solid ${expanded ? amber : "#e4e7ec"}`,
            marginBottom: "12px", overflow: "hidden",
            transition: "border-color 0.2s ease",
          }}>
            {/* Summary row */}
            <div onClick={() => {
              if (expanded) { setExpandedId(null); }
              else { setExpandedId(sub.id); setNotesDraft(sub.adminNotes || ""); }
            }}
              style={{ padding: "16px 18px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "14px" }}>

              {/* Status dot */}
              <div style={{ width: "10px", height: "10px", borderRadius: "50%",
                background: sc.text, flexShrink: 0 }} />

              {/* Name + subject */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                  fontWeight: 600, color: "#111827", marginBottom: "2px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sub.name || "Anonymous"}
                  {sub.subject && <span style={{ fontWeight: 400, color: "#6b7280" }}> — {sub.subject}</span>}
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "#9ca3af",
                  display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span>{prefIcon[sub.contactPref] || "📧"} Prefers {prefLabel[sub.contactPref] || "Email"}</span>
                  <span>·</span>
                  <span>{sub.source === "client" ? "Client portal" : "Landing page"}</span>
                  <span>·</span>
                  <span>{timeAgo}</span>
                </div>
              </div>

              {/* Status badge */}
              <span style={{
                background: sc.bg, border: `1px solid ${sc.border}`,
                borderRadius: "20px", padding: "3px 10px",
                fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                fontWeight: 600, color: sc.text, textTransform: "uppercase",
                letterSpacing: "0.5px", flexShrink: 0,
              }}>{sub.status}</span>

              {/* Chevron */}
              <span style={{ color: "#9ca3af", fontSize: "18px", flexShrink: 0,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.2s ease" }}>›</span>
            </div>

            {/* Expanded detail */}
            {expanded && (
              <div style={{ padding: "0 18px 18px", borderTop: "1px solid #f3f4f6" }}>
                <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Contact info */}
                  <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                    <div>
                      <div style={labelStyle}>Email</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827" }}>
                        {sub.email || "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Phone</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827" }}>
                        {sub.phone || "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Preferred Contact</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#111827" }}>
                        {prefIcon[sub.contactPref]} {prefLabel[sub.contactPref] || "Email"}
                      </div>
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <div style={labelStyle}>Message</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                      color: "#374151", lineHeight: "1.6", whiteSpace: "pre-wrap",
                      background: "#f9fafb", borderRadius: "10px", padding: "12px 14px",
                      marginTop: "4px" }}>
                      {sub.message || "—"}
                    </div>
                  </div>

                  {/* Admin notes */}
                  <div>
                    <div style={labelStyle}>Admin Notes</div>
                    <textarea rows={3} value={notesDraft}
                      onChange={e => setNotesDraft(e.target.value)}
                      placeholder="Add internal notes about this submission..."
                      style={{
                        width: "100%", padding: "11px 14px", borderRadius: "10px",
                        boxSizing: "border-box", border: "1.5px solid #e4e7ec",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                        color: "#111827", outline: "none", resize: "vertical",
                        marginTop: "4px",
                      }} />
                    <button onClick={() => handleSaveNotes(sub.id)}
                      style={{ marginTop: "6px", padding: "7px 14px", borderRadius: "8px",
                        border: "1.5px solid #e4e7ec", background: "#f9fafb",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: "#374151", cursor: "pointer" }}>Save Notes</button>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                    {sub.status !== "reviewed" && (
                      <button onClick={() => handleStatusChange(sub.id, "reviewed")}
                        style={{ padding: "8px 16px", borderRadius: "8px", border: "none",
                          background: "#16a34a", color: "#fff",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          fontWeight: 600, cursor: "pointer" }}>Mark Reviewed</button>
                    )}
                    {sub.status !== "archived" && (
                      <button onClick={() => handleStatusChange(sub.id, "archived")}
                        style={{ padding: "8px 16px", borderRadius: "8px",
                          border: "1.5px solid #e4e7ec", background: "#f9fafb",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#6b7280", cursor: "pointer" }}>Archive</button>
                    )}
                    {sub.status === "archived" && (
                      <button onClick={() => handleStatusChange(sub.id, "new")}
                        style={{ padding: "8px 16px", borderRadius: "8px",
                          border: "1.5px solid #e4e7ec", background: "#f9fafb",
                          fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                          color: "#6b7280", cursor: "pointer" }}>Reopen</button>
                    )}
                    <button onClick={() => { if (confirm("Delete this submission?")) handleDelete(sub.id); }}
                      style={{ padding: "8px 16px", borderRadius: "8px",
                        border: "1.5px solid #fca5a5", background: "#fff5f5",
                        fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
                        color: "#dc2626", cursor: "pointer" }}>Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return "";
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default AdminContactTab;
