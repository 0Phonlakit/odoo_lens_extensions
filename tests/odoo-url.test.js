import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOdooUrl, recordUrl, companyIds } from "../src/lib/odoo-url.js";

test("reads model and id from the Odoo 16/17 hash URL", () => {
  assert.deepEqual(parseOdooUrl("https://h.example/web#id=42&model=sale.order&view_type=form"),
    { model: "sale.order", id: 42, action: null });
});

test("reads a list view hash URL with an action and no id", () => {
  assert.deepEqual(parseOdooUrl("https://h.example/web?debug=1#action=123&model=sale.order&view_type=list"),
    { model: "sale.order", id: null, action: 123 });
});

test("reads the Odoo 17.2+ path URL with an action path", () => {
  assert.deepEqual(parseOdooUrl("https://h.example/odoo/sales/42"), { model: null, id: 42, action: "sales" });
});

test("reads a numeric action and a model segment in the path URL", () => {
  assert.deepEqual(parseOdooUrl("https://h.example/odoo/action-123/7"), { model: null, id: 7, action: 123 });
  assert.deepEqual(parseOdooUrl("https://h.example/odoo/sale.order/9"), { model: "sale.order", id: 9, action: null });
});

test("uses the last action/id pair of a nested path and ignores 'new'", () => {
  assert.deepEqual(parseOdooUrl("https://h.example/odoo/sales/42/action-456/7"), { model: null, id: 7, action: 456 });
  assert.deepEqual(parseOdooUrl("https://h.example/odoo/sales/new"), { model: null, id: null, action: "sales" });
});

test("accepts the backend home page with no record", () => {
  const empty = { model: null, id: null, action: null };
  assert.deepEqual(parseOdooUrl("https://h.example/web"), empty);
  assert.deepEqual(parseOdooUrl("https://h.example/web#menu_id=5"), empty);
  assert.deepEqual(parseOdooUrl("https://h.example/odoo"), empty);
});

test("reads the companies selected in the Odoo company switcher", () => {
  assert.deepEqual(companyIds("session_id=x; cids=2-1", ""), [2, 1]);
  assert.deepEqual(companyIds("", "#action=5&cids=3%2C1"), [3, 1]);
  assert.deepEqual(companyIds("session_id=x", "#action=5"), null);
});

test("returns null for pages that are not the Odoo backend", () => {
  assert.equal(parseOdooUrl("https://www.google.com/search?q=odoo"), null);
  assert.equal(parseOdooUrl("https://h.example/web/login"), null);
  assert.equal(parseOdooUrl("chrome://extensions"), null);
});

test("builds a record URL in the same style as the current page", () => {
  assert.equal(recordUrl("https://h.example/odoo/sales/42", "account.move", 5), "https://h.example/odoo/account.move/5");
  assert.equal(recordUrl("https://h.example/web#id=1&model=x", "account.move", 5),
    "https://h.example/web#id=5&model=account.move&view_type=form");
});
