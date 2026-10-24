import { NextResponse } from "next/server";
import { getAdminIdentity } from "../../../../../lib/auth";
import { can, ACTIONS } from "../../../../../lib/rbac";
import { getBalCounts, getBalRecentMarks } from "../../../../../lib/bal-attendance-db";

export const runtime = "nodejs";

const POLL_MINUTES = 20;

// Lightweight live-sync polled every few seconds by every phone:
//   - counts       — the EXACT present/total numbers, computed by the database
//                    (never accumulated client-side, so nobody drifts)
//   - recent       — marks set within the last POLL_MINUTES minutes, so a
//                    phone that was showing stale cards catches up
//   - serverTime   — lets the client measure work without trusting its clock
// Returns 204-ish-shaped JSON understood by the HTML app.
export async function GET() {
  const identity = await getAdminIdentity();
  if (!identity || !can(identity.role, ACTIONS.VIEW_SUBMISSIONS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [counts, recent] = await Promise.all([getBalCounts(), getBalRecentMarks({ minutes: POLL_MINUTES })]);
    return NextResponse.json({
      ok: true,
      serverTime: new Date().toISOString(),
      counts,
      recent: recent.map((r) => ({ id: r.id, at: r.attended_at, by: r.attended_by || "" })),
    });
  } catch (err) {
    console.error("BAL sync GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
