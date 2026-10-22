import crypto from "crypto";
import { makeNeon } from "./neon-connection.js";

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

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS submissions (
          id text PRIMARY KEY,
          created_at timestamptz NOT NULL DEFAULT now(),
          name text NOT NULL,
          phone text NOT NULL,
          zone_no text NOT NULL,
          zone_name text NOT NULL,
          zone_type text NOT NULL,
          sector_no text,
          sector_name text,
          zonal_incharge_name text,
          sector_incharge_name text,
          category text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb
        )
      `;
      await db`
        CREATE TABLE IF NOT EXISTS export_runs (
          id text PRIMARY KEY,
          created_at timestamptz NOT NULL DEFAULT now(),
          filter_name text NOT NULL,
          row_count integer NOT NULL
        )
      `;
      await db`
        ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attended_at timestamptz
      `;
      await db`
        ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reg_no text
      `;
      await db`
        CREATE SEQUENCE IF NOT EXISTS reg_serial_seq START 1
      `;
    })();
  }

  return schemaPromise;
}

export async function createSubmission(record) {
  await ensureSchema();
  const db = sql();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  let regNo = record.regNo || null;
  if (!regNo && record.category === "gbm-ebm") {
    const [seqRow] = await db`SELECT nextval('reg_serial_seq') AS n`;
    regNo = `HH${seqRow.n}`;
  }

  await db`
    INSERT INTO submissions (
      id,
      created_at,
      name,
      phone,
      zone_no,
      zone_name,
      zone_type,
      sector_no,
      sector_name,
      zonal_incharge_name,
      sector_incharge_name,
      category,
      reg_no,
      payload
    ) VALUES (
      ${id},
      ${createdAt},
      ${record.name},
      ${record.phone},
      ${record.zoneNo},
      ${record.zoneName},
      ${record.zoneType},
      ${record.sectorNo || null},
      ${record.sectorName || null},
      ${record.zonalInchargeName || null},
      ${record.sectorInchargeName || null},
      ${record.category},
      ${regNo},
      ${JSON.stringify(record.payload || {})}::jsonb
    )
  `;

  return { id, createdAt, regNo };
}

export async function getStats() {
  await ensureSchema();
  const db = sql();
  const [totalRow] = await db`SELECT COUNT(*)::int AS count FROM submissions`;
  const [last12Row] = await db`SELECT COUNT(*)::int AS count FROM submissions WHERE created_at >= now() - interval '12 hours'`;
  const [last24Row] = await db`SELECT COUNT(*)::int AS count FROM submissions WHERE created_at >= now() - interval '24 hours'`;
  const [todayRow] = await db`SELECT COUNT(*)::int AS count FROM submissions WHERE created_at >= date_trunc('day', now())`;
  const [lastExportRow] = await db`
    SELECT created_at
    FROM export_runs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const sinceLastExportAt = lastExportRow?.created_at || null;
  const sinceLastExportRow = sinceLastExportAt
    ? await db`SELECT COUNT(*)::int AS count FROM submissions WHERE created_at >= ${sinceLastExportAt}`
    : totalRow;

  return {
    total: totalRow?.count || 0,
    last12h: last12Row?.count || 0,
    last24h: last24Row?.count || 0,
    today: todayRow?.count || 0,
    sinceLastExport: sinceLastExportRow?.count || 0,
    lastExportAt: sinceLastExportAt,
  };
}

export async function getRecentSubmissions(limit = 25) {
  await ensureSchema();
  const db = sql();
  return db`
    SELECT *
    FROM submissions
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getSubmissions(range = "all", categories = null) {
  await ensureSchema();
  const db = sql();
  const lastExport = await db`
    SELECT created_at
    FROM export_runs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const sinceLastExportAt = lastExport?.[0]?.created_at || null;

  const hasCategoryFilter = Array.isArray(categories) && categories.length > 0;
  const extra = hasCategoryFilter ? db` AND category = ANY(${categories})` : db``;

  if (range === "since_last_export" && sinceLastExportAt) {
    return db`
      SELECT *
      FROM submissions
      WHERE created_at >= ${sinceLastExportAt}${extra}
      ORDER BY created_at DESC
    `;
  }

  if (range === "12h") {
    return db`
      SELECT *
      FROM submissions
      WHERE created_at >= now() - interval '12 hours'${extra}
      ORDER BY created_at DESC
    `;
  }

  if (range === "24h") {
    return db`
      SELECT *
      FROM submissions
      WHERE created_at >= now() - interval '24 hours'${extra}
      ORDER BY created_at DESC
    `;
  }

  if (range === "today") {
    return db`
      SELECT *
      FROM submissions
      WHERE created_at >= date_trunc('day', now())${extra}
      ORDER BY created_at DESC
    `;
  }

  return db`
    SELECT *
    FROM submissions
    ${hasCategoryFilter ? db`WHERE category = ANY(${categories})` : db``}
    ORDER BY created_at DESC
  `;
}

const SORT_COLUMNS = {
  created_at: "created_at",
  name: "name",
  phone: "phone",
  zone_no: "zone_no",
};

export const NEGATIVE_FILTERS = {
  "pracharak-mahatma": [
    { id: "sound", label: "Sound needs improvement", fields: ["mahilaSound", "balSound", "emsSound"], vals: ["poor"] },
    { id: "clarity-no", label: "Message clarity: No", fields: ["mahilaMessageClarity", "balMessageClarity", "emsMessageClarity"], vals: ["no"] },
    { id: "content-apt-no", label: "Content apt: No", fields: ["mahilaContentApt", "balContentApt", "emsContentApt"], vals: ["no"] },
    {
      id: "overall-negative",
      label: "Negative overall rating",
      arrays: [
        { key: "mahilaOverall", vals: ["scope-of-improvement", "no-zeal-in-satsang"] },
        { key: "balOverall", vals: ["scope-of-improvement", "no-zeal-in-satsang"] },
        { key: "emsOverall", vals: ["scope-of-improvement", "no-zeal-in-satsang"] },
      ],
    },
    { id: "program-issues", label: "Program issues reported", exists: ["mahilaProgramIssues", "balProgramIssues", "emsProgramIssues"] },
  ],
  "branch-incharge": [
    { id: "arrival-late", label: "Arrived late", fields: ["arrivalTime"], vals: ["late"] },
    { id: "conduct-not-good", label: "Conduct average/poor", fields: ["conduct"], vals: ["average", "poor"] },
  ],
  "gbm-ebm": [{ id: "not-available", label: "Not available for 79th Samagam", fields: ["available79thSamagam"], vals: ["no"] }],
};

function buildNegativeConditions(db, negIds, categories) {
  const cats = Array.isArray(categories) && categories.length ? categories : Object.keys(NEGATIVE_FILTERS);
  const conds = [];
  for (const cat of cats) {
    const rules = NEGATIVE_FILTERS[cat] || [];
    for (const rule of rules) {
      if (!negIds.includes(rule.id)) continue;
      for (const field of rule.fields || []) {
        for (const val of rule.vals) {
          conds.push(db`(category = ${cat} AND payload->>${field} = ${val})`);
        }
      }
      for (const arr of rule.arrays || []) {
        for (const val of arr.vals) {
          conds.push(db`(category = ${cat} AND payload->${arr.key} @> ${JSON.stringify(val)}::jsonb)`);
        }
      }
      for (const key of rule.exists || []) {
        conds.push(db`(category = ${cat} AND payload ? ${key})`);
      }
    }
  }
  return conds;
}

export async function getSubmissionsPage({
  q = "",
  category = "",
  zoneType = "",
  zone = "",
  branch = "",
  neg = "",
  sort = "created_at",
  order = "desc",
  page = 1,
  limit = 20,
} = {}) {
  await ensureSchema();
  const db = sql();
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;
  const sortCol = SORT_COLUMNS[sort] || "created_at";
  const dir = order === "asc" ? "ASC" : "DESC";

  const conds = [];
  if (q && String(q).trim()) {
    const raw = String(q).trim().replace(/[%_]/g, (c) => "\\" + c);
    const term = `%${raw}%`;
    conds.push(db`(name ILIKE ${term} ESCAPE '\\' OR phone ILIKE ${term} ESCAPE '\\' OR zone_no ILIKE ${term} ESCAPE '\\' OR zone_name ILIKE ${term} ESCAPE '\\' OR payload->>'branch' ILIKE ${term} ESCAPE '\\' OR reg_no ILIKE ${term} ESCAPE '\\')`);
  }
  if (category && category !== "all") conds.push(db`category = ${category}`);
  if (zoneType && zoneType !== "all") conds.push(db`zone_type = ${zoneType}`);
  if (zone && zone !== "all") conds.push(db`zone_no = ${zone}`);
  if (branch && branch !== "all") conds.push(db`payload->>'branch' = ${branch}`);

  const negIds = String(neg || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (negIds.length) {
    const negConds = buildNegativeConditions(db, negIds, category && category !== "all" ? [category] : null);
    if (negConds.length) {
      let negOr = db`${negConds[0]}`;
      for (let i = 1; i < negConds.length; i += 1) {
        negOr = db`${negOr} OR ${negConds[i]}`;
      }
      conds.push(db`(${negOr})`);
    } else {
      conds.push(db`false`);
    }
  }

  let where = db``;
  if (conds.length) {
    where = db`WHERE ${conds[0]}`;
    for (let i = 1; i < conds.length; i += 1) {
      where = db`${where} AND ${conds[i]}`;
    }
  }

  const [countRow] = await db`SELECT COUNT(*)::int AS count FROM submissions ${where}`;
  const rows = await db`
    SELECT *
    FROM submissions ${where}
    ORDER BY ${db.unsafe(`${sortCol} ${dir}`)}
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  return { rows, total: countRow?.count || 0 };
}

export async function getChartData() {
  await ensureSchema();
  const db = sql();

  const daily = await db`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM submissions
    WHERE created_at >= now() - interval '13 days'
    GROUP BY day
    ORDER BY day
  `;
  const byCategory = await db`
    SELECT category, COUNT(*)::int AS count
    FROM submissions
    GROUP BY category
    ORDER BY count DESC
  `;
  const byZoneType = await db`
    SELECT zone_type, COUNT(*)::int AS count
    FROM submissions
    GROUP BY zone_type
    ORDER BY count DESC
  `;
  const topZones = await db`
    SELECT zone_no, zone_name, COUNT(*)::int AS count
    FROM submissions
    GROUP BY zone_no, zone_name
    ORDER BY count DESC
    LIMIT 8
  `;

  return { daily, byCategory, byZoneType, topZones };
}

// Distinct branch names typed into Bal-Mahila-EMS / Branch Incharge payloads,
// used for the dashboard "filter by branch" dropdown.
export async function distinctBranches() {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT payload->>'branch' AS branch
    FROM submissions
    WHERE payload->>'branch' IS NOT NULL AND payload->>'branch' <> ''
    ORDER BY branch
  `;
  return rows.map((r) => r.branch);
}

// Submission counts keyed by zone_no, merged with the full zone list
// (lib/zones.js) by the facets route to show which zones are done.
export async function zoneCompletionCounts() {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT zone_no, COUNT(*)::int AS count
    FROM submissions
    WHERE zone_no IS NOT NULL AND zone_no <> ''
    GROUP BY zone_no
  `;
  return new Map(rows.map((r) => [String(r.zone_no), r.count]));
}

// Counts for the Bal Mahila vs EMS pie chart on the dashboard. The real
// type marker lives on the Bal-Mahila-EMS registrations as payload.sewa
// (ems | bal | mahila) — that is what attendees pick when registering.
export async function getFeedbackPie() {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT payload->>'sewa' AS sewa, COUNT(*)::int AS count
    FROM submissions
    WHERE category = 'gbm-ebm'
      AND payload->>'sewa' IS NOT NULL
      AND payload->>'sewa' <> ''
    GROUP BY payload->>'sewa'
  `;
  const pie = { mahila: 0, bal: 0, ems: 0 };
  for (const r of rows) if (pie[r.sewa] !== undefined) pie[r.sewa] = r.count;
  return pie;
}

// Bulk delete used by the dashboard's multi-select delete. Password is NOT
// checked here — the route handler owns that; this only deletes by ids.
// Submission ids are UUIDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteSubmissions(ids) {
  await ensureSchema();
  const db = sql();
  const safeIds = (Array.isArray(ids) ? ids : [])
    .map((x) => String(x || "").trim().toLowerCase())
    .filter((x) => UUID_RE.test(x))
    .slice(0, 1000);
  if (!safeIds.length) return { deleted: 0, ids: [] };
  const result = await db`
    DELETE FROM submissions
    WHERE id::text = ANY(${safeIds})
    RETURNING id
  `;
  return { deleted: result.length, ids: result.map((r) => r.id) };
}

export async function recordExportRun(filterName, rowCount) {
  await ensureSchema();
  const db = sql();
  return db`
    INSERT INTO export_runs (id, filter_name, row_count)
    VALUES (${crypto.randomUUID()}, ${filterName}, ${rowCount})
    RETURNING created_at
  `;
}

export async function latestExportAt() {
  await ensureSchema();
  const db = sql();
  const [row] = await db`
    SELECT created_at
    FROM export_runs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row?.created_at || null;
}

export async function markAttended(marks) {
  await ensureSchema();
  const db = sql();
  let updated = 0;
  for (const mark of marks) {
    const id = String(mark.id || "").trim();
    if (!id) continue;
    const at = mark.at ? new Date(mark.at) : new Date();
    if (Number.isNaN(at.getTime())) continue;
    const result = await db`
      UPDATE submissions
      SET attended_at = ${at.toISOString()}
      WHERE id = ${id}
      RETURNING id
    `;
    updated += result?.length || 0;
  }
  return { updated };
}
