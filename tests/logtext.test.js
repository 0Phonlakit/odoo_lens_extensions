import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, noteChange } from "../src/lib/logtext.js";

const base = { t: 0, ms: 10, err: null, src: "odoo", note: null, ids: null, vals: null, preview: "" };

test("describes reads in plain words", () => {
  assert.deepEqual(
    pick(describe({ ...base, model: "sale.order", method: "web_search_read" })),
    { kind: "read", text: "ค้นหา sale.order" });
  assert.deepEqual(
    pick(describe({ ...base, model: "sale.order", method: "web_read", ids: [42] })),
    { kind: "read", text: "อ่าน sale.order #42" });
});

test("describes a write from the page with the new values", () => {
  const d = describe({ ...base, model: "sale.order", method: "write", ids: [41], vals: { user_id: 7, note: "x" }, preview: "[41], {...}" });
  assert.equal(d.kind, "write");
  assert.equal(d.text, "แก้ไข sale.order #41");
  assert.deepEqual(d.changes, [["user_id", null, "7"], ["note", null, "x"]]);
  assert.equal(d.call, "sale.order.write([41], {...})");
});

test("uses the extension's own note when the call came from Odoo Lens", () => {
  const d = describe({ ...base, src: "lens", model: "sale.order", method: "write", ids: [41], vals: { user_id: 7 },
    note: { text: "แก้ไข SO0041", changes: [["พนักงานขาย", "วิภา", "สมชาย"]] } });
  assert.equal(d.text, "แก้ไข SO0041");
  assert.deepEqual(d.changes, [["พนักงานขาย", "วิภา", "สมชาย"]]);
});

test("describes create, delete and button calls", () => {
  assert.deepEqual(pick(describe({ ...base, model: "res.partner", method: "create", vals: { name: "A" } })),
    { kind: "create", text: "สร้าง res.partner" });
  assert.deepEqual(pick(describe({ ...base, model: "sale.order", method: "unlink", ids: [3, 4] })),
    { kind: "delete", text: "ลบ sale.order #3, #4" });
  assert.deepEqual(pick(describe({ ...base, model: "sale.order", method: "action_confirm", ids: [42] })),
    { kind: "action", text: "กดปุ่ม action_confirm ที่ sale.order #42" });
});

test("reads Odoo 17+ form saves (web_save) as edit or create", () => {
  assert.deepEqual(pick(describe({ ...base, model: "sale.order", method: "web_save", ids: [5], vals: { note: "x" } })),
    { kind: "write", text: "แก้ไข sale.order #5" });
  assert.deepEqual(pick(describe({ ...base, model: "sale.order", method: "web_save", ids: null, vals: { note: "x" } })),
    { kind: "create", text: "สร้าง sale.order" });
});

test("marks failed calls as errors and keeps the Odoo message", () => {
  const d = describe({ ...base, model: "sale.order", method: "unlink", ids: [41], err: "You can not delete a confirmed order." });
  assert.equal(d.kind, "error");
  assert.equal(d.text, "ผิดพลาด: You can not delete a confirmed order. (ลบ sale.order #41)");
});

test("shortens long values", () => {
  const d = describe({ ...base, model: "x", method: "write", ids: [1], vals: { body: "a".repeat(200) } });
  assert.equal(d.changes[0][2].length, 61);
});

test("builds a log change that hides secret fields and stays short", () => {
  assert.deepEqual(noteChange("password", "Password", "old", "new"), ["Password", "••••", "••••"]);
  assert.deepEqual(noteChange("totp_secret", "2FA", null, "abc"), ["2FA", null, "••••"]);
  assert.deepEqual(noteChange("name", "Name", "A", "B"), ["Name", "A", "B"]);
  assert.equal(noteChange("note", "Note", null, "ก".repeat(300))[2].length, 61);
});

function pick(d) {
  return { kind: d.kind, text: d.text };
}
