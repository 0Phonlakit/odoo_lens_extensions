/**
 * Group line-to-line links by the document the linked line belongs to.
 *
 * @param {{parent: number, product: string, own: number, other: number}[]} pairs
 *   One entry per linked line pair, e.g. a sale order line and its invoice line.
 * @returns {{parent: number, lines: Array<[string, number, number]>}[]}
 *   Documents in first-seen order, each with [product, own line id, other line id] rows.
 */
export function groupByParent(pairs) {
  const groups = new Map();
  for (const p of pairs) {
    if (!groups.has(p.parent)) groups.set(p.parent, { parent: p.parent, lines: [] });
    groups.get(p.parent).lines.push([p.product, p.own, p.other]);
  }
  return [...groups.values()];
}
