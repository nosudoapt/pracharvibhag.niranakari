import { NextResponse } from "next/server";
import { getAdminIdentity } from "../../../../../lib/auth";
import { can, ACTIONS } from "../../../../../lib/rbac";
import {
  getBalRoster,
  getBalMarks,
  getBalCounts,
  ensureBalSchema,
} from "../../../../../lib/bal-attendance-db";
import { toCompactRow } from "../../../../../lib/bal-attendance";

export const runtime = "nodejs";

// Full load: the whole Bal-Mahila-EMS roster (compact rows) + the complete
// marks map + exact counts. Fetched once per login; after that phones only
// pull the lightweight /sync payload, so 10 devices polling stay cheap.
export async function GET() {
  const identity = await getAdminIdentity();
  if (!identity || !can(identity.role, ACTIONS.VIEW_SUBMISSIONS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await ensureBalSchema();
    const [roster, marks, counts] = await Promise.all([getBalRoster(), getBalMarks(), getBalCounts()]);
    return NextResponse.json({
      ok: true,
      loadedAt: new Date().toISOString(),
      counts,
      marks,
      roster: roster.map(toCompactRow),
    });
  } catch (err) {
    console.error("BAL roster GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
