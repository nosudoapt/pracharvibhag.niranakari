import { NextResponse } from "next/server";
import { getAdminIdentity } from "../../../../../lib/auth";
import { can, ACTIONS } from "../../../../../lib/rbac";
import { getBalRoster, getBalMarks } from "../../../../../lib/bal-attendance-db";
import { typeLabel, istTodayISO } from "../../../../../lib/bal-attendance";
import { buildXlsx } from "../../../../../lib/xlsx-writer";

export const runtime = "nodejs";

// GET → .xlsx download of the Bal-Mahila-EMS attendance list (Bal / Mahila /
// EMS satsangs). Sheet 1: full roster + ONE "Present or Not" column for the
// selected day (no per-date columns as requested). Sheet 2 is the mark log for
// THAT SAME DAY only — one row per person, so no other dates (and therefore no
// lookalike duplicates) appear.
export async function GET(request) {
  const identity = await getAdminIdentity();
  if (!identity || !can(identity.role, ACTIONS.EXPORT_SUBMISSIONS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Selected day — either ?date=YYYY-MM-DD or today in IST.
    let day = istTodayISO();
    const q = new URL(request.url).searchParams.get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) day = q;

    const roster = await getBalRoster();
    const marks = await getBalMarks();

    const presentToday = new Set(
      Object.keys(marks).filter((id) => String(marks[id]?.at || "").slice(0, 10) === day)
    );

    const attendanceRows = [
      [
        "Reg No",
        "Code",
        "Name",
        "Phone",
        "Type",
        "Branch",
        "Zone",
        "Sector",
        { v: "Present or Not", bold: true },
      ].map((h) => (typeof h === "object" ? h : { v: h, bold: true })),
      ...roster.map((r) => [
        r.regNo || "",
        r.code || "",
        r.name || "",
        r.phone || "",
        typeLabel(r.sewa || ""),
        r.branch || "",
        r.zoneNo ? `${r.zoneNo} ${r.zoneName || ""}` : r.zoneName || "",
        r.sectorName || "",
        presentToday.has(r.id) ? "Present" : "Not present",
      ]),
    ];

    const markLogRows = [
      ["Reg No", "Code", "Name", "Type", "Date", "Marked at (server time)", "Marked by"].map((h) => ({
        v: h,
        bold: true,
      })),
      // mark log for the SELECTED day only — one row per person, no other dates
      ...Object.keys(marks)
        .map((id) => ({ id, mark: marks[id] }))
        .filter(({ mark }) => String(mark?.at || "").slice(0, 10) === day)
        .map(({ id, mark }) => {
          const r = roster.find((x) => x.id === id);
          return [
            r?.regNo || "",
            r?.code || "",
            r?.name || "",
            typeLabel(r?.sewa || ""),
            String(mark?.at || "").slice(0, 10),
            String(mark?.at || ""),
            mark?.by || "",
          ];
        }),
    ];

    const buf = buildXlsx([
      {
        name: "Attendance",
        columns: [
          { width: 10 },
          { width: 8 },
          { width: 34 },
          { width: 18 },
          { width: 12 },
          { width: 16 },
          { width: 20 },
          { width: 14 },
          { width: 14 },
        ],
        rows: attendanceRows,
      },
      {
        name: "Mark log",
        columns: [
          { width: 10 },
          { width: 8 },
          { width: 34 },
          { width: 12 },
          { width: 12 },
          { width: 22 },
          { width: 18 },
        ],
        rows: markLogRows,
      },
    ]);

    const filename = `bal-attendance-${day}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("BAL attendance export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
