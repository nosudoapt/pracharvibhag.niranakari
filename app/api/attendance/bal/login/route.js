import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUD_ATTENDANCE, createSessionToken, adminCookieOptions } from "../../../../../lib/auth";
import { verifyBalUser } from "../../../../../lib/bal-attendance-db";
import { recordAudit } from "../../../../../lib/access-db";

export const runtime = "nodejs";

// Login for the Bal-Mahila-EMS attendance field team (rec1 + admin).
// Same signed session cookie format and RBAC as the GP attendance login, but
// its own audience-tagged accounts, so an attendance login can never sign into
// the admin area and site admins keep their separate sessions.
// Accepts `password` or `pin` as the credential field.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const username = String(body?.username || "").trim();
  const password = String(body?.password ?? body?.pin ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  try {
    const user = await verifyBalUser(username, password);
    if (!user) {
      return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
    }
    const store = await cookies();
    const token = createSessionToken(user.username, user.role, Date.now(), AUD_ATTENDANCE);
    store.set("snm_admin_session", token, adminCookieOptions());
    await recordAudit({ actorEmail: user.username, action: "attendance.bal.login", target: user.username, detail: { role: user.role } });
    return NextResponse.json({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    console.error("BAL attendance login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
