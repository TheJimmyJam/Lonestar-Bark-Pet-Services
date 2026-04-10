import { useState, useEffect, useCallback } from "react";
import { loadAuditLog } from "../../supabase.js";

const amber = "#B45309";
const cardBg = "#1e1e1e";
const surface = "#2a2a2a";

// ─── Human-readable labels ────────────────────────────────────────────────────
const ACTION_LABELS = {
  walk_completed:        "Walk Completed",
  walk_uncompleted:      "Walk Un-completed",
  booking_cancelled:     "Booking Cancelled",
  booking_edited:        "Booking Edited",
  booking_deleted:       "Booking Deleted",
  client_added:          "Client Added",
  client_edited:         "Client Edited",
  client_deleted:        "Client Deleted",
  walker_added:          "Walker Added",
  walker_edited:         "Walker Edited",
  walker_deleted:        "Walker Deleted",
  invoice_sent:          "Invoice Sent",
  invoice_paid:          "Invoice Marked Paid",
  invoice_deleted:       "Invoice Deleted",
  payroll_completed:     "Payroll Completed",
  admin_added:           "Admin Added",
  admin_removed:         "Admin Removed",
  walker_assigned:       "Walker Assigned",
  walk_scheduled:        "Walk Scheduled",
};

const ENTITY_ICONS = {
  client:  "👥",
  walker:  "🦺",
  booking: "📅",
  invoice: "🧾",
  payroll: "💵",
  admin:   "🛡️",
};

const ACTION_COLORS = {
  walk_completed:    "#16a34a",
  walk_uncompleted:  "#d97706",
  booking_cancelled: "#dc2626",
  booking_deleted:   "#dc2626",
  client_deleted:    "#dc2626",
  walker_deleted:    "#dc2626",
  invoice_deleted:   "#dc2626",
  admin_removed:     "#dc2626",
  invoice_paid:      "#16a34a",
  payroll_completed: "#16a34a",
  client_added:      "#2563eb",
  walker_added:      "#2563eb",
  admin_added:       "#2563eb",
  walk_scheduled:    "#2563eb",
};

function formatAuditTime(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1)  return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs  < 24) return `${diffHrs}h ago · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (diffDays < 7)  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
                            " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
         " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function detailsToString(details = {}) {
  if (!details || Object.keys(details).length === 0) return null;
  const parts = [];
  if (details.clientName)  parts.push(details.clientName);
  if (details.walkerName)  parts.push(`Walker: ${details.walkerName}`);
  if (details.pet)         parts.push(`Pet: ${details.pet}`);
  if (details.date)        parts.push(details.date);
  if (details.service)     parts.push(details.service);
  if (details.amount !== undefined) parts.push(`$${Number(details.amount).toFixed(2)}`);
  if (details.invoiceId)   parts.push(`Invoice #${details.invoiceId}`);
  if (details.targetName)  parts.push(details.targetName);
  if (details.note)        parts.push(details.note);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminAuditTab({ admin }) {
  const [log, setLog]             = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterAdmin,  setFilterAdmin]  = useState("all");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadAuditLog({ limit: 500 });
      setLog(rows);
    } catch (e) {
      setError("Could not load audit log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Derived filter options ──
  const adminNames = [...new Set(log.map(r => r.adminName).filter(Boolean))].sort();
  const entityTypes = [...new Set(log.map(r => r.entityType).filter(Boolean))].sort();

  const filtered = log.filter(r => {
    if (filterEntity !== "all" && r.entityType !== filterEntity) return false;
    if (filterAdmin  !== "all" && r.adminName  !== filterAdmin)  return false;
    if (search) {
      const q = search.toLowerCase();
      const label = (ACTION_LABELS[r.action] || r.action || "").toLowerCase();
      const adminN = (r.adminName || "").toLowerCase();
      const det = JSON.stringify(r.details || {}).toLowerCase();
      if (!label.includes(q) && !adminN.includes(q) && !det.includes(q)) return false;
    }
    return true;
  });

  const pill = { display: "inline-block", padding: "2px 10px", borderRadius: "20px",
    fontSize: "12px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
            fontSize: "22px", color: "#fff" }}>🕵️ Audit Log</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
            color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
            Every admin action — who did it, when, and what changed.
          </div>
        </div>
        <button onClick={refresh}
          style={{ padding: "9px 18px", borderRadius: "10px", border: "none",
            background: amber, color: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "18px" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search actions, admins, details…"
          style={{ flex: "1 1 220px", padding: "9px 14px", borderRadius: "10px",
            border: "1.5px solid rgba(255,255,255,0.12)", background: surface,
            color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "14px",
            outline: "none" }}
        />
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: "10px",
            border: "1.5px solid rgba(255,255,255,0.12)", background: surface,
            color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
          <option value="all">All types</option>
          {entityTypes.map(t => (
            <option key={t} value={t}>{(ENTITY_ICONS[t] || "") + " " + t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <select value={filterAdmin} onChange={e => setFilterAdmin(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: "10px",
            border: "1.5px solid rgba(255,255,255,0.12)", background: surface,
            color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
          <option value="all">All admins</option>
          {adminNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Count */}
      {!loading && (
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
          color: "rgba(255,255,255,0.4)", marginBottom: "12px" }}>
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          {log.length !== filtered.length ? ` (filtered from ${log.length})` : ""}
        </div>
      )}

      {/* States */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0",
          fontFamily: "'DM Sans', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: "15px" }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca",
          borderRadius: "12px", padding: "16px 20px", color: "#dc2626",
          fontFamily: "'DM Sans', sans-serif", fontSize: "14px" }}>
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0",
          fontFamily: "'DM Sans', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: "15px" }}>
          {log.length === 0 ? "No events yet — actions will appear here as admins use the system." : "No events match your filters."}
        </div>
      )}

      {/* Log rows */}
      {!loading && !error && filtered.map(row => {
        const actionLabel = ACTION_LABELS[row.action] || row.action || "Unknown action";
        const dotColor = ACTION_COLORS[row.action] || "#9ca3af";
        const icon = ENTITY_ICONS[row.entityType] || "📝";
        const detail = detailsToString(row.details);
        const isExpanded = expanded === row.id;

        return (
          <div key={row.id}
            onClick={() => setExpanded(isExpanded ? null : row.id)}
            style={{ background: cardBg, border: "1.5px solid rgba(255,255,255,0.08)",
              borderRadius: "12px", padding: "14px 18px", marginBottom: "8px",
              cursor: "pointer", transition: "border-color 0.15s",
              borderColor: isExpanded ? amber : "rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              {/* Color dot + icon */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                paddingTop: "3px", gap: "4px", minWidth: "24px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%",
                  background: dotColor, flexShrink: 0 }} />
                <span style={{ fontSize: "14px" }}>{icon}</span>
              </div>
              {/* Main content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px",
                  flexWrap: "wrap", marginBottom: "2px" }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                    fontSize: "14px", color: "#fff" }}>{actionLabel}</span>
                  {row.adminName && (
                    <span style={{ ...pill, background: "rgba(180,83,9,0.2)", color: amber }}>
                      {row.adminName}
                    </span>
                  )}
                </div>
                {detail && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                    color: "rgba(255,255,255,0.55)", marginTop: "2px",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {detail}
                  </div>
                )}
              </div>
              {/* Timestamp */}
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px",
                color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", paddingTop: "2px",
                flexShrink: 0 }}>
                {formatAuditTime(row.createdAt)}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ marginTop: "14px", paddingTop: "14px",
                borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "10px" }}>
                  {[
                    ["Action",      row.action],
                    ["Admin",       row.adminName || "—"],
                    ["Admin ID",    row.adminId || "—"],
                    ["Type",        row.entityType || "—"],
                    ["Entity ID",   row.entityId || "—"],
                    ["Timestamp",   row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: surface, borderRadius: "8px",
                      padding: "10px 14px" }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                        color: "rgba(255,255,255,0.4)", marginBottom: "3px",
                        textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px",
                        color: "#fff", wordBreak: "break-all" }}>{value}</div>
                    </div>
                  ))}
                </div>
                {row.details && Object.keys(row.details).length > 0 && (
                  <div style={{ marginTop: "10px", background: surface, borderRadius: "8px",
                    padding: "10px 14px" }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px",
                      color: "rgba(255,255,255,0.4)", marginBottom: "6px",
                      textTransform: "uppercase", letterSpacing: "0.05em" }}>Details</div>
                    <pre style={{ fontFamily: "monospace", fontSize: "12px", color: "rgba(255,255,255,0.7)",
                      margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
