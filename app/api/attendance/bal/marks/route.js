import { NextResponse } from "next/server";
import { getAdminIdentity } from "../../../../../lib/auth";
import { can, ACTIONS } from "../../../../../lib/rbac";
import { markBal, unmarkBal, getBalCounts, getBalRecentMarks } from "../../../../../lib/bal-attendance-db";
import { recordAudit } from "../../../../../lib/access-db";

export const runtime = "nodejs";

// Mark present (recorder/editor and up):
//   body { marks: [{ id, at? }] }                  — source field optional
// Undo (ADMIN ONLY, by design: rec1 et al. can never take attendance back):
//   body { unmark: [{ id }] }
// Both are idempotent PK updates, safe under the 10-phones-at-once load, and
// the response always carries the fresh server-computed counts + recent marks
// so the caller's screen can true itself up immediately.
export async function POST(request) {
  const identity = await getAdminIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (Array.isArray(body?.unmark)) {
      if (identity.role !== "super_admin") {
        return NextResponse.json({ error: "Only Admin can undo a mark" }, { status: 403 });
      }
      const result = await unmarkBal(body.unmark.map((e) => ({ id: e.id })));
      await recordAudit({ actorEmail: identity.email, action: "attendance.bal.unmark", target: `${result.removed} row(s)` });
      const [counts, recent] = await Promise.all([getBalCounts(), getBalRecentMarks({})]);
      return NextResponse.json({ ok: true, removed: result.removed, counts, recent: recent.map((r) => ({ id: r.id, at: r.attended_at, by: r.attended_by || "" })) });
    }

    if (!can(identity.role, ACTIONS.MANAGE_DUTY)) {
      // viewers can look but not mark
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!Array.isArray(body?.marks)) {
      return NextResponse.json({ error: "Invalid body: marks array required" }, { status: 400 });
    }

    const prepared = body.marks.slice(0, 5000).map((m) => ({
      id: m.id,
      at: m.at,
    }));
    const result = await markBal(prepared, identity.email + (body?.via ? ` (${body.via})` : ""));
    await recordAudit({
      actorEmail: identity.email,
      action: "attendance.bal.mark",
      target: `${result.updated} row(s)`,
      detail: { via: body?.via || "live" },
    });
    const [counts, recent] = await Promise.all([getBalCounts(), getBalRecentMarks({})]);
    return NextResponse.json({
      ok: true,
      updated: result.updated,
      counts,
      recent: recent.map((r) => ({ id: r.id, at: r.attended_at, by: r.attended_by || "" })),
    });
  } catch (err) {
    console.error("BAL attendance POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
