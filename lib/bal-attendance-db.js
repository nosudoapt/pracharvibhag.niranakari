// lib/bal-attendance-db.js
// Persistence for the Bal-Mahila-EMS live attendance feature.
//
// Conventions copied from lib/gp-attendance-db.js / lib/access-db.js:
// lazily-initialised neon() client, idempotent ensureSchema() guarded by a
// module-level promise, tagged-template SQL.
//
// Data model = the pre-registrations themselves:
//   submissions (category = 'gbm-ebm')  — one row per registered person.
//       attended_at  timestamptz  — set when someone marks them present.
//       attended_by  text         — who marked (username). Added on boot.
//   bal_attendance_users                — field accounts (rec1 + admin...).
//       Same viewer|editor|super_admin scheme as lib/rbac.js.
//
// Concurrency story (10 phones at once):
//   A mark is an UPDATE on a PRIMARY KEY row — it can never insert a second
//   row for the same person, idempotent under any retry pattern, and Neon's
//   pooled Postgres handles concurrent writers. Overwrites do NOT shift the
//   first-mark moment: COALESCE keeps the earliest mark intact.

import crypto from "crypto";
import { makeNeon } from "./neon-connection.js";
import { normalizeRole, ROLES } from "./rbac.js";
import { BAL_CATEGORY, DEFAULT_BAL_USERS, parseUsersEnv, shortCode } from "./bal-attendance.js";

let sqlClient = null;
let schemaPromise = null;

function sql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  if (!sqlClient) {
    sqlClient = makeNeon(connectionString);
  }
  return sqlClient;
}

export async function ensureBalSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = sql();
      // Who marked, so the log can name the recorder.
      await db`
        ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attended_by text
      `;
      // Counts and syncs filter on these constantly (2700+ rows).
      await db`CREATE INDEX IF NOT EXISTS submissions_attended_at_idx ON submissions (attended_at)`;
      await db`CREATE INDEX IF NOT EXISTS submissions_category_created_idx ON submissions (category, created_at DESC)`;
      await db`
        CREATE TABLE IF NOT EXISTS bal_attendance_users (
          username text PRIMARY KEY,
          name text,
          role text NOT NULL DEFAULT 'viewer',
          pin_hash text NOT NULL,
          salt text NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_login_at timestamptz
        )
      `;
      await seedBalUsers();
    })();
  }
  return schemaPromise;
}

// ---------------------------------------------------------------------------
// PIN hashing (scrypt + per-user salt) — same scheme as gp-attendance
// ---------------------------------------------------------------------------

export function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), String(salt), 32).toString("hex");
}

export function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function seedBalUsers() {
  const db = sql();
  const [row] = await db`SELECT COUNT(*)::int AS n FROM bal_attendance_users`;
  if (row?.n > 0) return; // seed only an empty table — env changes need user management or a wipe
  const entries = parseUsersEnv(process.env.BAL_ATTENDANCE_USERS, DEFAULT_BAL_USERS);
  for (const e of entries) {
    const salt = makeSalt();
    await db`
      INSERT INTO bal_attendance_users (username, name, role, pin_hash, salt, active)
      VALUES (${e.username.toLowerCase()}, ${e.username}, ${normalizeRole(e.role)}, ${hashPin(e.pin, salt)}, ${salt}, true)
      ON CONFLICT (username) DO NOTHING
    `;
  }
  if (entries.some((e) => e.role === ROLES.SUPER_ADMIN)) return;
  // Break-glass: make sure an admin account always exists so undo is possible.
  const salt = makeSalt();
  const pin = process.env.BAL_ADMIN_PIN || "bal-admin-1234";
  console.warn("[bal-attendance] No super_admin account was configured — seeded default admin (username: admin). Change its PIN.");
  await db`
    INSERT INTO bal_attendance_users (username, name, role, pin_hash, salt, active)
    VALUES ('admin', 'Admin', ${ROLES.SUPER_ADMIN}, ${hashPin(pin, salt)}, ${salt}, true)
    ON CONFLICT (username) DO NOTHING
  `;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

// Accepts `password` (the documented field) or `pin` for parity with the GP app.
export async function verifyBalUser(username, password) {
  const u = normalizeUsername(username);
  if (!u || !password) return null;
  await ensureBalSchema();
  const db = sql();
  const rows = await db`
    SELECT username, name, role, pin_hash, salt, active
    FROM bal_attendance_users WHERE username = ${u}
  `;
  const row = rows[0];
  if (!row || !row.active) return null;
  if (!safeEqualHex(row.pin_hash, hashPin(password, row.salt))) return null;
  await db`UPDATE bal_attendance_users SET last_login_at = now() WHERE username = ${u}`;
  return { username: row.username, name: row.name || row.username, role: normalizeRole(row.role) };
}

export async function listBalUsers() {
  await ensureBalSchema();
  const db = sql();
  return db`
    SELECT username, name, role, active, created_at, last_login_at
    FROM bal_attendance_users
    ORDER BY active DESC, username ASC
  `;
}

// Add or update. `pin` optional on update (keeps the existing PIN).
export async function upsertBalUser({ username, name, pin, role, active }) {
  const u = normalizeUsername(username);
  if (!u) throw new Error("username required");
  const r = normalizeRole(role);
  const a = active === undefined ? true : !!active;
  await ensureBalSchema();
  const db = sql();
  if (pin) {
    const salt = makeSalt();
    await db`
      INSERT INTO bal_attendance_users (username, name, role, pin_hash, salt, active)
      VALUES (${u}, ${name || u}, ${r}, ${hashPin(pin, salt)}, ${salt}, ${a})
      ON CONFLICT (username) DO UPDATE
        SET name = ${name || u}, role = ${r}, active = ${a}, pin_hash = ${hashPin(pin, salt)}, salt = ${salt}
    `;
  } else {
    await db`
      UPDATE bal_attendance_users SET name = ${name || u}, role = ${r}, active = ${a}
      WHERE username = ${u}
    `;
  }
  const rows = await db`SELECT username, name, role, active, created_at, last_login_at FROM bal_attendance_users WHERE username = ${u}`;
  return rows[0];
}

export async function setBalUserActive(username, active) {
  const u = normalizeUsername(username);
  await ensureBalSchema();
  const db = sql();
  return db`UPDATE bal_attendance_users SET active = ${!!active} WHERE username = ${u} RETURNING username, name, role, active`;
}

// ---------------------------------------------------------------------------
// Roster (compact rows — see lib/bal-attendance.js for the format)
// ---------------------------------------------------------------------------

export async function getBalRoster() {
  await ensureBalSchema();
  const db = sql();
  const rows = await db`
    SELECT id, reg_no, name, phone, zone_no, zone_name, sector_no, sector_name,
           payload ->> 'sewa' AS sewa,
           payload ->> 'branch' AS branch,
           created_at
    FROM submissions
    WHERE category = ${BAL_CATEGORY}
    ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    regNo: r.reg_no || "",
    name: r.name,
    phone: r.phone,
    sewa: r.sewa || "",
    branch: r.branch || "",
    zoneNo: r.zone_no || "",
    zoneName: r.zone_name || "",
    sectorNo: r.sector_no || "",
    sectorName: r.sector_name || "",
    createdAt: r.created_at,
    code: shortCode(r.id),
  }));
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// marks: [{ id, at? }] — mark a submission present. Idempotent and
// concurrency-safe: primary-key UPDATE only, and COALESCE keeps the FIRST
// mark's moment (a late duplicate tap from another device never shifts it).
// `by` should identify the recorder (username).
export async function markBal(marks, by = "") {
  await ensureBalSchema();
  const db = sql();
  let updated = 0;
  for (const m of marks.slice(0, 5000)) {
    const id = String(m.id || "").trim().toLowerCase();
    if (!UUID_RE.test(id)) continue;
    const at = m.at ? new Date(m.at) : new Date();
    if (Number.isNaN(at.getTime())) continue;
    const result = await db`
      UPDATE submissions
      SET attended_at = COALESCE(attended_at, ${at.toISOString()}::timestamptz),
          attended_by = COALESCE(attended_by, ${String(by || "")}::text)
      WHERE id = ${id}
      RETURNING id
    `;
    updated += result.length;
  }
  return { updated };
}

// entries: [{ id }] — ADMIN-ONLY removal.
export async function unmarkBal(entries) {
  await ensureBalSchema();
  const db = sql();
  let removed = 0;
  for (const e of entries.slice(0, 5000)) {
    const id = String(e.id || "").trim().toLowerCase();
    if (!UUID_RE.test(id)) continue;
    const result = await db`
      UPDATE submissions
      SET attended_at = NULL, attended_by = NULL
      WHERE id = ${id} AND attended_at IS NOT NULL
      RETURNING id
    `;
    removed += result.length;
  }
  return { removed };
}

// Full marks map (id → { at, by }) for the initial page load.
export async function getBalMarks() {
  await ensureBalSchema();
  const db = sql();
  const rows = await db`
    SELECT id, attended_at, attended_by
    FROM submissions
    WHERE category = ${BAL_CATEGORY} AND attended_at IS NOT NULL
    ORDER BY attended_at DESC
  `;
  const map = {};
  for (const r of rows) {
    map[r.id] = { at: r.attended_at, by: r.attended_by || "" };
  }
  return map;
}

// Exact per-type + overall counts. These are the numbers shown live on all
// phones, straight from the database — never accumulated on the client.
export async function getBalCounts() {
  await ensureBalSchema();
  const db = sql();
  const [overall] = await db`
    SELECT COUNT(*)::int AS total, COUNT(attended_at)::int AS present
    FROM submissions
    WHERE category = ${BAL_CATEGORY}
  `;
  const rows = await db`
    SELECT payload ->> 'sewa' AS sewa, COUNT(*)::int AS total, COUNT(attended_at)::int AS present
    FROM submissions
    WHERE category = ${BAL_CATEGORY}
    GROUP BY sewa
  `;
  const byType = {};
  for (const r of rows) {
    if (r.sewa) byType[r.sewa] = { total: r.total, present: r.present };
  }
  return {
    total: overall?.total || 0,
    present: overall?.present || 0,
    byType,
  };
}

// Recently-changed marks for the 5-second live sync. Covers everything a
// phone could have fallen behind on in the last window (20 min default).
export async function getBalRecentMarks({ minutes = 20, limit = 2000 } = {}) {
  await ensureBalSchema();
  const db = sql();
  const lim = Math.min(Math.max(1, Number(limit) || 2000), 5000);
  const mins = Math.min(Math.max(1, Number(minutes) || 20), 1440);
  return db`
    SELECT id, attended_at, attended_by
    FROM submissions
    WHERE category = ${BAL_CATEGORY} AND attended_at >= now() - ${`${mins} minutes`}::interval
    ORDER BY attended_at DESC
    LIMIT ${lim}
  `;
}
