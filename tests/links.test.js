import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLinks, resolveParent } from "../src/lib/links.js";

const INV = "sale.order.line.invoice_lines";
const PICK = "sale.order.line.move_ids";

test("groups linked lines by target document and linking field, keeping order", () => {
  const pairs = [
    { parentModel: "account.move", parentId: 118, via: INV, label: "PVC pipe", own: 101, other: 5501 },
    { parentModel: "account.move", parentId: 131, via: INV, label: "Glue", own: 103, other: 5630 },
    { parentModel: "stock.picking", parentId: 87, via: PICK, label: "PVC pipe", own: 101, other: 9120 },
    { parentModel: "account.move", parentId: 118, via: INV, label: "Tee joint", own: 102, other: 5502 }
  ];
  assert.deepEqual(groupLinks(pairs), [
    { parentModel: "account.move", parentId: 118, via: INV, lines: [["PVC pipe", 101, 5501], ["Tee joint", 102, 5502]] },
    { parentModel: "account.move", parentId: 131, via: INV, lines: [["Glue", 103, 5630]] },
    { parentModel: "stock.picking", parentId: 87, via: PICK, lines: [["PVC pipe", 101, 9120]] }
  ]);
});

test("drops a line pair found twice through two line lists of the same document", () => {
  const p = { parentModel: "sale.order", parentId: 42, via: "account.move.line.sale_line_ids", label: "PVC pipe", own: 5501, other: 101 };
  assert.deepEqual(groupLinks([p, { ...p }]), [{ parentModel: "sale.order", parentId: 42, via: p.via, lines: [["PVC pipe", 5501, 101]] }]);
});

test("returns nothing when no line is linked", () => {
  assert.deepEqual(groupLinks([]), []);
});

test("picks the parent document a target line actually belongs to", () => {
  const candidates = [
    { model: "mrp.production", field: "raw_material_production_id" },
    { model: "stock.picking", field: "picking_id" }
  ];
  assert.deepEqual(resolveParent(candidates, { id: 9120, raw_material_production_id: false, picking_id: [87, "WH/OUT/00087"] }),
    { model: "stock.picking", field: "picking_id", id: 87 });
  assert.deepEqual(resolveParent(candidates, { id: 9300, raw_material_production_id: 12, picking_id: false }),
    { model: "mrp.production", field: "raw_material_production_id", id: 12 });
  assert.equal(resolveParent(candidates, { id: 9400, raw_material_production_id: false, picking_id: false }), null);
});
