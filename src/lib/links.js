/**
 * Group line-to-line links by the document the linked line belongs to and the field that links them.
 *
 * @param {{parentModel: string, parentId: number, via: string, label: string, own: number, other: number}[]} pairs
 *   One entry per linked line pair, e.g. a sale order line and the invoice line it points to.
 * @returns {{parentModel: string, parentId: number, via: string, lines: Array<[string, number, number]>}[]}
 *   Documents in first-seen order, each with unique [label, own line id, other line id] rows.
 */
export function groupLinks(pairs) {
  const groups = new Map();
  const seen = new Set();
  for (const p of pairs) {
    const key = `${p.parentModel}|${p.parentId}|${p.via}`;
    if (seen.has(`${key}|${p.own}|${p.other}`)) continue;
    seen.add(`${key}|${p.own}|${p.other}`);
    if (!groups.has(key)) groups.set(key, { parentModel: p.parentModel, parentId: p.parentId, via: p.via, lines: [] });
    groups.get(key).lines.push([p.label, p.own, p.other]);
  }
  return [...groups.values()];
}

/**
 * Find which parent document a line belongs to, among the parent fields its model can have.
 *
 * @param {{model: string, field: string}[]} candidates - Parent model and the line's field pointing to it.
 * @param {Object} record - The line as returned by read(), holding the candidate fields.
 * @returns {{model: string, field: string, id: number}|null}
 */
export function resolveParent(candidates, record) {
  for (const c of candidates) {
    const v = record[c.field];
    if (v) return { model: c.model, field: c.field, id: Array.isArray(v) ? v[0] : v };
  }
  return null;
}
