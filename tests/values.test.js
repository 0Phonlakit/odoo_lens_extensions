import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDomain, parseDomain, formatDomain, formatValue, parseInput } from "../src/lib/values.js";

const META = {
  name: { type: "char" },
  amount_total: { type: "monetary" },
  qty: { type: "integer" },
  active: { type: "boolean" },
  state: { type: "selection", selection: [["draft", "Quotation"], ["sale", "Sales Order"]] },
  partner_id: { type: "many2one" },
  line_ids: { type: "one2many" },
  date_order: { type: "datetime" },
  date: { type: "date" }
};

test("builds a domain from filter rows and skips empty values", () => {
  assert.deepEqual(buildDomain([
    { field: "state", op: "=", value: "sale" },
    { field: "amount_total", op: ">=", value: "1000" },
    { field: "active", op: "=", value: "false" },
    { field: "name", op: "ilike", value: "" }
  ], META), [["state", "=", "sale"], ["amount_total", ">=", 1000], ["active", "=", false]]);
});

test("converts typed dates in filters to the format Odoo expects", () => {
  assert.deepEqual(buildDomain([{ field: "date", op: ">=", value: "01/11/2026" }], META), [["date", ">=", "2026-11-01"]]);
  assert.match(buildDomain([{ field: "date_order", op: "<=", value: "20/11/2026 10:00:00" }], META)[0][2], /^2026-11-20 \d{2}:00:00$/);
});

test("rejects a filter number that is not a number instead of searching for nothing", () => {
  assert.throws(() => buildDomain([{ field: "qty", op: "=", value: "abc" }], META), /ตัวเลข/);
});

test("parses a Python-style domain typed by a developer", () => {
  assert.deepEqual(parseDomain("[('state', '=', 'sale'), ('amount_total', '>', 10.5), ('active', '=', True), ('x', '=', None)]"),
    [["state", "=", "sale"], ["amount_total", ">", 10.5], ["active", "=", true], ["x", "=", null]]);
  assert.deepEqual(parseDomain("['|', ('name', 'ilike', \"O'Neil\"), ('id', 'in', [1, 2])]"),
    ["|", ["name", "ilike", "O'Neil"], ["id", "in", [1, 2]]]);
  assert.deepEqual(parseDomain(""), []);
});

test("prints a domain in Python syntax that parses back to the same domain", () => {
  const domain = ["|", ["name", "ilike", "O'Neil"], ["id", "in", [1, 2]], ["active", "=", false], ["x", "=", null]];
  const text = formatDomain(domain);
  assert.equal(text, "['|', ('name', 'ilike', 'O\\'Neil'), ('id', 'in', [1, 2]), ('active', '=', False), ('x', '=', None)]");
  assert.deepEqual(parseDomain(text), domain);
});

test("rejects a domain that is not a list", () => {
  assert.throws(() => parseDomain("('state', '=', 'sale')"), /list/);
  assert.throws(() => parseDomain("[('state', '=', "), /domain/i);
});

test("formats Odoo values for display", () => {
  assert.equal(formatValue([7, "Siam Co."], META.partner_id), "Siam Co.");
  assert.equal(formatValue(false, META.partner_id), "");
  assert.equal(formatValue(false, META.active), "ไม่");
  assert.equal(formatValue(true, META.active), "ใช่");
  assert.equal(formatValue([1, 2, 3], META.line_ids), "3 รายการ");
  assert.equal(formatValue(1234.5, META.amount_total), "1,234.50");
  assert.equal(formatValue("sale", META.state), "Sales Order");
  assert.equal(formatValue("2026-11-20", META.date), "20/11/2026");
  assert.match(formatValue("2026-11-20 07:05:09", META.date_order), /^\d{2}\/\d{2}\/2026 \d{2}:05:09$/);
});

test("turns typed text back into an Odoo value for writing", () => {
  assert.equal(parseInput("12", META.qty), 12);
  assert.equal(parseInput("1,234.50", META.amount_total), 1234.5);
  assert.equal(parseInput("true", META.active), true);
  assert.equal(parseInput("20/11/2026", META.date), "2026-11-20");
  assert.equal(parseInput("", META.name), false);
  assert.equal(parseInput("hello", META.name), "hello");
  assert.throws(() => parseInput("abc", META.qty), /ตัวเลข/);
});
