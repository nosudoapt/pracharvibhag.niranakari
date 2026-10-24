// lib/bal-attendance.js
// Pure, dependency-free logic for the Bal-Mahila-EMS live attendance feature so
// it can be unit-tested with `node --test` and reused by the API routes and the
// phone-friendly HTML app (public/bal-attendance.html).
//
// The roster is NOT a spreadsheet like the GP list — it is the Bal-Mahila-EMS
// pre-registrations themselves (submissions with category = "gbm-ebm",
// reg_no like HH123). Attendance = attended_at (+ attended_by) on that row, so
// one row per person makes duplicate marks structurally impossible.

// Default field-team accounts (seeded on first boot unless overridden):
//   rec1  / rec1234   → editor    ("Recorder" — can mark, CANNOT undo)
//   admin / admin1234 → super_admin ("Admin" — mark + undo + manage users)
export const DEFAULT_BAL_USERS = [
  { username: "rec1", pin: "rec1234", role: "editor" },
  { username: "admin", pin: "admin1234", role: "super_admin" },
];

export const BAL_CATEGORY = "gbm-ebm";

export const BAL_TYPES = Object.freeze({
  bal: "Bal",
  mahila: "Mahila",
  ems: "EMS",
});

export function isBalType(t) {
  return Object.prototype.hasOwnProperty.call(BAL_TYPES, t);
}

export function typeLabel(t) {
  return BAL_TYPES[t] || "General";
}

// ---------------------------------------------------------------------------
// Normalization / search
// ---------------------------------------------------------------------------

// Lowercase, alphanumerics only — the search normalization everywhere.
export function normSearch(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

// The short attendee code shown on cards and usable in search: a stable slice
// of the submission UUID (fallback when reg_no is missing).
export function shortCode(id) {
  return String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

// The searchable shadow-fields for one roster record (all lowercase-ish).
export function searchFields(rec) {
  return {
    nname: normSearch(rec.name),
    nphone: digitsOnly(rec.phone),
    ncode: digitsOnly(rec.regNo) + digitsOnly(shortCode(rec.id)),
    nreg: normSearch(rec.regNo), // e.g. "hh123" — typing the full code still hits
    nbranch: normSearch(rec.branch),
    nzone: normSearch(rec.zoneNo) + normSearch(rec.zoneName),
    nsector: normSearch(rec.sectorName),
  };
}

// One query may contain letters (name / zone / branch) and digits (phone /
// reg_No / code) mixed; every token must match its own field type. Substring
// matching so the last few digits of a phone number are enough.
export function matchRecord(f, query, nq) {
  if (!nq) return true;
  const tokens = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // digits → phone, or reg/HH number ("HH" prefix is optional in search)
      const d = digitsOnly(t);
      if (!(f.nphone.includes(d) || f.ncode.includes(d))) return false;
    } else {
      const norm = normSearch(t);
      if (!(f.nname.includes(norm) || f.nbranch.includes(norm) || f.nzone.includes(norm) ||
            f.nsector.includes(norm) || f.nreg.includes(norm) || f.ncode.includes(norm))) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compact roster rows (bandwidth: ~2700 people must fit into one phone fetch)
// ---------------------------------------------------------------------------
// Row format (array keeps it ~3x smaller than JSON objects):
//   [id, regNo, code, name, phone, sewa, branch, zoneNo, zoneName, sectorNo, sectorName, createdDay]
// where code is the short attendee code and createdDay is "yyyy-mm-dd".

export function toCompactRow(r) {
  return [
    r.id,
    r.regNo || "",
    shortCode(r.id),
    r.name || "",
    r.phone || "",
    r.sewa || "",
    r.branch || "",
    r.zoneNo || "",
    r.zoneName || "",
    r.sectorNo || "",
    r.sectorName || "",
    String(r.createdAt || "").slice(0, 10),
  ];
}

export function fromCompactRow(row) {
  const rec = {
    id: row[0],
    regNo: row[1],
    code: row[2],
    name: row[3] || "(name not given)",
    phone: row[4] || "",
    sewa: isBalType(row[5]) ? row[5] : "",
    branch: row[6] || "",
    zoneNo: row[7] || "",
    zoneName: row[8] || "",
    sectorNo: row[9] || "",
    sectorName: row[10] || "",
    createdDay: row[11] || "",
  };
  rec.f = searchFields(rec);
  return rec;
}

// ---------------------------------------------------------------------------
// Mark merge (server marks + this device's optimistic marks stay consistent)
// ---------------------------------------------------------------------------

// serverMarks: { id: { at, by } } — already merged from responses.
// pending: [{ id, at }] — this device's unsent entries.
// merge = server entry wins when both exist (server is authoritative); the
// optimistic copy only fills the screen until the server confirms.
export function mergedMark(serverMarks, pending, id) {
  if (serverMarks[id]) return serverMarks[id];
  const p = (pending || []).find((x) => x.id === id);
  return p ? { at: p.at, by: p.by || "this device (unsent)" } : null;
}

export function countPresent(records, serverMarks, pending) {
  let n = 0;
  for (const r of records) if (mergedMark(serverMarks, pending, r.id)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function roleLabel(role) {
  return role === "super_admin" ? "Admin" : role === "editor" ? "Recorder" : "Viewer";
}

export function rankOfRole(role) {
  return role === "super_admin" ? 3 : role === "editor" ? 2 : role === "viewer" ? 1 : 0;
}

export function canRole(role, minRole) {
  return rankOfRole(role) >= rankOfRole(minRole);
}

// Undo (removing a mark) is an ADMIN-ONLY capability, per project rule:
// recorders (rec1 etc.) mark present but can never take attendance back.
export function canUndo(role) {
  return role === "super_admin";
}

// ---------------------------------------------------------------------------
// BAL_ATTENDANCE_USERS parsing: "username:pin:role,..."
// ---------------------------------------------------------------------------

export function parseUsersEnv(raw, fallback) {
  const entries = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [username, pin, role] = s.split(":").map((x) => x.trim());
      return username && pin ? { username, pin, role: role || "editor" } : null;
    })
    .filter(Boolean);
  return entries.length ? entries : fallback || DEFAULT_BAL_USERS;
}
