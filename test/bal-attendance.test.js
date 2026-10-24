import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BAL_USERS,
  canUndo,
  canRole,
  roleLabel,
  countPresent,
  matchRecord,
  mergedMark,
  parseUsersEnv,
  searchFields,
  shortCode,
  fromCompactRow,
  toCompactRow,
} from "../lib/bal-attendance.js";

test("default accounts: rec1 recorder, admin super_admin", () => {
  assert.equal(DEFAULT_BAL_USERS.length, 2);
  assert.deepEqual(
    DEFAULT_BAL_USERS.map((u) => [u.username, u.pin, u.role]),
    [["rec1", "rec1234", "editor"], ["admin", "admin1234", "super_admin"]],
  );
});

test("undo is admin-only — recorders and viewers can never undo", () => {
  assert.equal(canUndo("super_admin"), true);
  assert.equal(canUndo("editor"), false);
  assert.equal(canUndo("viewer"), false);
  assert.equal(canUndo(undefined), false);
});

test("role helpers", () => {
  assert.equal(roleLabel("super_admin"), "Admin");
  assert.equal(roleLabel("editor"), "Recorder");
  assert.equal(roleLabel("viewer"), "Viewer");
  assert.equal(canRole("editor", "editor"), true);
  assert.equal(canRole("editor", "super_admin"), false);
  assert.equal(canRole("super_admin", "editor"), true);
});

test("parseUsersEnv: env string wins; empty falls back to defaults", () => {
  const env = parseUsersEnv("abc:1234:editor", DEFAULT_BAL_USERS);
  assert.deepEqual(env, [{ username: "abc", pin: "1234", role: "editor" }]);
  assert.equal(parseUsersEnv("", DEFAULT_BAL_USERS), DEFAULT_BAL_USERS);
  assert.equal(parseUsersEnv("  ", DEFAULT_BAL_USERS), DEFAULT_BAL_USERS);
  const noRole = parseUsersEnv("x:pin", DEFAULT_BAL_USERS);
  assert.equal(noRole[0].role, "editor");
});

test("shortCode is a stable 8-char code", () => {
  const id = "1d0f2e5a-9a1b-4c2d-8e3f-aabbccddeeff";
  assert.equal(shortCode(id), "1D0F2E5A");
  assert.equal(shortCode(id), shortCode(id));
});

test("toCompactRow / fromCompactRow round-trip rebuilds search fields", () => {
  const rec = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    regNo: "HH123",
    name: "Sh. Raj Kumar Ji",
    phone: "9812345678",
    sewa: "bal",
    branch: "Model Town",
    zoneNo: "05",
    zoneName: "Ludhiana",
    sectorNo: "3",
    sectorName: "Sabharwal Coaching",
    createdAt: "2026-10-15T10:00:00.000Z",
  };
  const row = toCompactRow(rec);
  assert.ok(Array.isArray(row));
  const back = fromCompactRow(row);
  assert.equal(back.id, rec.id);
  assert.equal(back.regNo, "HH123");
  assert.equal(back.name, rec.name);
  assert.equal(back.sewa, "bal");
  assert.equal(back.code, shortCode(rec.id));
  assert.ok(back.f.nname.includes("rajkumar"));
  assert.ok(back.f.nphone.includes("9812345678"));
  assert.ok(back.f.ncode.includes("123"));
  assert.ok(back.f.nreg.includes("hh123"));
});

test("search: name; last digits of phone; full HH code; digits-only route; multi-token", () => {
  const rec = fromCompactRow(toCompactRow({
    id: "550e8400-e29b-41d4-a716-446655440000",
    regNo: "HH123", name: "Sh. Raj Kumar Ji", phone: "+91 98123 45678",
    sewa: "ems", branch: "Model Town", zoneNo: "05", zoneName: "Ludhiana",
    sectorName: "Sabharwal Coaching",
  }));
  const f = rec.f;
  assert.equal(matchRecord(f, "raj kumar", "rajkumar"), true);
  assert.equal(matchRecord(f, "45678", "45678"), true); // last digits of phone
  assert.equal(matchRecord(f, "HH123", "hh123"), true); // full reg code
  assert.equal(matchRecord(f, "123", "123"), true);     // reg digits (code optional prefix)
  assert.equal(matchRecord(f, "ludhiana", "ludhiana"), true);
  assert.equal(matchRecord(f, "raj 45678", "raj45678"), true); // mixing fields
  assert.equal(matchRecord(f, "99999", "99999"), false);       // wrong digits
  assert.equal(matchRecord(f, "hari", "hari"), false);         // wrong name
  assert.equal(matchRecord(f, "", ""), true);                  // empty query = all
});

test("mergedMark: server wins over the same device's optimistic mark", () => {
  const server = { "id-1": { at: "2026-10-24T06:00:00.000Z", by: "rec1" } };
  const pending = [{ id: "id-1", at: "2026-10-24T06:00:05.000Z" }];
  assert.deepEqual(mergedMark(server, pending, "id-1"), server["id-1"]);
  // a device-side mark that has not reached the server yet still shows up
  assert.deepEqual(mergedMark({}, pending, "id-1"), { at: pending[0].at, by: "this device (unsent)" });
  assert.equal(mergedMark({}, [], "id-3"), null);
});

test("countPresent counts the merged view exactly once per person", () => {
  const records = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const server = { a: { at: "x", by: "rec1" }, b: { at: "y", by: "admin" } };
  const pending = [{ id: "c", at: "z" }, { id: "a", at: "dup" }]; // a already on server
  assert.equal(countPresent(records, server, pending), 3);
  assert.equal(countPresent(records, {}, []), 0);
});
