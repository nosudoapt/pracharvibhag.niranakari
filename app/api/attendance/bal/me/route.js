import { NextResponse } from "next/server";
import { getAdminIdentity } from "../../../../../lib/auth";

export const runtime = "nodejs";

// "Who am I?" for the Bal-Mahila-EMS attendance app. Works for BOTH audiences:
// an attendance login (recorder/viewer/admin) and a site-admin login. The app
// uses this to skip its login screen when the unified /admin/login door has
// already authenticated the browser.
export async function GET() {
  const identity = await getAdminIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: {
      username: identity.email,
      name: identity.email,
      role: identity.role,
    },
    aud: identity.aud,
  });
}
