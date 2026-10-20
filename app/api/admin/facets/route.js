import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { distinctBranches, zoneCompletionCounts, getFeedbackPie } from "../../../../lib/db";
import { listAllZones } from "../../../../lib/zones";

export const runtime = "nodejs";

// GET → filter/chart building blocks for the dashboard:
// - branches: distinct branch names for the "filter by branch" dropdown
// - zones:    EVERY zone (from the roster) with its submission count and a
//             done flag, so the dashboard can list which zones are done
// - pie:      Bal / Mahila / EMS counts for the pie chart
export async function GET() {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [branches, countsByZone, pie] = await Promise.all([
      distinctBranches(),
      zoneCompletionCounts(),
      getFeedbackPie(),
    ]);

    const zones = listAllZones().map((z) => {
      const count = countsByZone.get(String(z.zoneNo)) || 0;
      return { zoneNo: z.zoneNo, zoneName: z.zoneName, kind: z.kind, count, done: count > 0 };
    });

    return NextResponse.json({ branches, zones, pie });
  } catch (err) {
    console.error("Facets error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
