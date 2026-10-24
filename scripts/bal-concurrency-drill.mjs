// Concurrency drill: simulate 10 phones hammering the marks endpoint at once.
// Usage: node scripts/bal-concurrency-drill.mjs [dupTapsPerId]
import { readFileSync } from "node:fs";

const PORT = process.env.PORT || 3002;
const DUP_TAPS = Number(process.argv[2] || 2);
const jar = readFileSync("/tmp/rec1.jar", "utf8");
const lines = jar.split("\n").filter((l) => l.includes("snm_admin_session"));
const token = lines[0].trim().split(/\t/).pop();

async function api(path, init) {
  return fetch(`http://localhost:${PORT}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: `snm_admin_session=${token}` },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

const roster = await api("/api/attendance/bal/roster");
const rows = roster.body.roster.slice(1, 11); // 10 people
console.log("people:", rows.length, "dup taps per person:", DUP_TAPS);

const jobs = [];
for (const [id] of rows) for (let i = 0; i < DUP_TAPS; i++) jobs.push(id);

const t0 = Date.now();
const results = await Promise.all(
  jobs.map(async (id, i) => {
    const r = await api("/api/attendance/bal/marks", {
      method: "POST",
      body: JSON.stringify({ marks: [{ id, at: new Date(Date.now() + i).toISOString() }] }),
      signal: AbortSignal.timeout(60000),
    });
    return { id, status: r.status, ok: r.body?.ok, updated: r.body?.updated };
  })
);
const statuses = {};
for (const r of results) statuses[r.status] = (statuses[r.status] || 0) + 1;
console.log(`posts: ${jobs.length} in ${Date.now() - t0}ms → statuses`, JSON.stringify(statuses));
const bad = results.filter((r) => r.status !== 200 || !r.ok);
if (bad.length) console.log("bad responses:", JSON.stringify(bad.slice(0, 5)));

const sync = await api("/api/attendance/bal/sync");
console.log("server counts:", JSON.stringify(sync.body.counts));
const expect = rows.length;
if (sync.body.counts.present === expect) {
  console.log(`PASS: exactly ${expect} present for ${expect} people despite ${jobs.length} concurrent taps`);
} else {
  console.log(`FAIL: expected present=${expect}`);
  process.exit(1);
}
