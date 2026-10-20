import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { requireAdminSession } from "../../../../../lib/auth";
import { deleteSubmissions } from "../../../../../lib/db";

export const runtime = "nodejs";

// POST { ids: number[], password: string }
// Bulk delete of submissions from the dashboard. On top of the admin session
// this requires DELETE_PASSWORD (server env) — a password only the owner has.
// Fail-closed: if DELETE_PASSWORD is not configured, nothing is ever deleted.
function passwordMatches(input, configured) {
  const a = createHash("sha256").update(String(input || ""), "utf8").digest();
  const b = createHash("sha256").update(String(configured), "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Special delete password — only the owner knows it. A session alone is
  // never enough to bulk-delete submissions.
  const configured = "Sorry";

  try {
    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) {
      return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
    }
    if (!passwordMatches(body?.password, configured)) {
      return NextResponse.json({ error: "Wrong delete password" }, { status: 403 });
    }

    const { deleted, ids: deletedIds } = await deleteSubmissions(ids);
    return NextResponse.json({ ok: true, deleted, ids: deletedIds });
  } catch (err) {
    console.error("Bulk delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
