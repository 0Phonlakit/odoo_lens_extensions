import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const HOOK = readFileSync(new URL("../src/page/hook.js", import.meta.url), "utf8");

class FakeXHR {
  constructor() { this.listeners = {}; this.status = 0; this.responseType = ""; this.responseText = ""; }
  open() {}
  setRequestHeader() {}
  send(body) { this.sent = body; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  respond(status, text) { this.status = status; this.responseText = text; this.listeners.loadend?.(); }
}

function load(fetchImpl = async () => ({ ok: true, status: 200 })) {
  const ctx = { XMLHttpRequest: class extends FakeXHR {}, fetch: fetchImpl, performance: { now: () => 0 }, Date, JSON, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(HOOK, ctx);
  return ctx;
}

function rpc(model, method, args, kwargs = {}) {
  return JSON.stringify({ jsonrpc: "2.0", method: "call", params: { model, method, args, kwargs } });
}

function xhrCall(ctx, url, body, status = 200, response = '{"jsonrpc": "2.0", "id": 1, "result": true}') {
  const x = new ctx.XMLHttpRequest();
  x.open("POST", url);
  x.send(body);
  x.respond(status, response);
}

test("records an Odoo write made by the page with ids and new values", () => {
  const ctx = load();
  xhrCall(ctx, "/web/dataset/call_kw/sale.order/write", rpc("sale.order", "write", [[41], { user_id: 7 }]));
  const [e] = ctx.__odooLens.entries();
  assert.equal(e.model, "sale.order");
  assert.equal(e.method, "write");
  assert.deepEqual([...e.ids], [41]);
  assert.deepEqual({ ...e.vals }, { user_id: 7 });
  assert.equal(e.src, "odoo");
  assert.equal(e.err, null);
});

test("keeps the Odoo error message of a failed call", () => {
  const ctx = load();
  xhrCall(ctx, "/web/dataset/call_button", rpc("sale.order", "action_cancel", [[42]]), 200,
    '{"jsonrpc": "2.0", "id": 2, "error": {"code": 200, "message": "Odoo Server Error", "data": {"message": "Cannot cancel"}}}');
  assert.equal(ctx.__odooLens.entries()[0].err, "Cannot cancel");
});

test("ignores requests that are not Odoo model calls", () => {
  const ctx = load();
  xhrCall(ctx, "/web/webclient/translations", "{}");
  xhrCall(ctx, "/mail/data", rpc("x", "y", []));
  assert.equal(ctx.__odooLens.entries().length, 0);
});

test("never stores password values", () => {
  const ctx = load();
  xhrCall(ctx, "/web/dataset/call_kw/res.users/change_password", rpc("res.users", "change_password", ["old-secret", "new-secret"]));
  xhrCall(ctx, "/web/dataset/call_kw/res.users/write", rpc("res.users", "write", [[2], { password: "new-secret", name: "A" }]));
  const text = JSON.stringify(ctx.__odooLens.entries());
  assert.doesNotMatch(text, /secret/);
});

test("labels calls made by Odoo Lens through fetch and lets it mark them failed", async () => {
  const ctx = load();
  const note = encodeURIComponent(JSON.stringify({ n: 1, text: "แก้ไข SO0041" }));
  await ctx.fetch("/web/dataset/call_kw/sale.order/write", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Odoo-Lens": note },
    body: rpc("sale.order", "write", [[41], { note: "x" }])
  });
  ctx.__odooLens.fail(note, "Access denied");
  const [e] = ctx.__odooLens.entries();
  assert.equal(e.src, "lens");
  assert.equal(e.note.text, "แก้ไข SO0041");
  assert.equal(e.err, "Access denied");
});

test("skips background reads that Odoo Lens marks as internal", async () => {
  const ctx = load();
  await ctx.fetch("/web/dataset/call_kw/sale.order/fields_get", {
    method: "POST", headers: { "X-Odoo-Lens": "-" }, body: rpc("sale.order", "fields_get", [])
  });
  assert.equal(ctx.__odooLens.entries().length, 0);
});

test("keeps only the latest 200 calls and can be cleared", () => {
  const ctx = load();
  for (let i = 0; i < 205; i++) xhrCall(ctx, "/web/dataset/call_kw/x/read", rpc("x", "read", [[i]]));
  const all = ctx.__odooLens.entries();
  assert.equal(all.length, 200);
  assert.equal(all[0].ids[0], 5);
  ctx.__odooLens.clear();
  assert.equal(ctx.__odooLens.entries().length, 0);
});

test("installs only once per page", () => {
  const ctx = load();
  vm.runInContext(HOOK, ctx);
  xhrCall(ctx, "/web/dataset/call_kw/x/read", rpc("x", "read", [[1]]));
  assert.equal(ctx.__odooLens.entries().length, 1);
});
