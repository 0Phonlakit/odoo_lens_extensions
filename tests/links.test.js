import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByParent } from "../src/lib/links.js";

test("groups linked lines under the document they belong to, keeping order", () => {
  const pairs = [
    { parent: 118, product: "PVC pipe", own: 101, other: 5501 },
    { parent: 131, product: "Glue", own: 103, other: 5630 },
    { parent: 118, product: "Tee joint", own: 102, other: 5502 }
  ];
  assert.deepEqual(groupByParent(pairs), [
    { parent: 118, lines: [["PVC pipe", 101, 5501], ["Tee joint", 102, 5502]] },
    { parent: 131, lines: [["Glue", 103, 5630]] }
  ]);
});

test("returns nothing when no line is linked", () => {
  assert.deepEqual(groupByParent([]), []);
});
