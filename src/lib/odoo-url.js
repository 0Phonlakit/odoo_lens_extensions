/**
 * Read which record or action an Odoo backend URL points at.
 * Supports the hash URLs of Odoo 16/17 (/web#id=..&model=..) and the
 * path URLs of Odoo 17.2+ (/odoo/<action>/<id>[/<action>/<id>...]).
 *
 * @param {string} href - The page URL.
 * @returns {{model: string|null, id: number|null, action: number|string|null}|null}
 *   null when the URL is not an Odoo backend page.
 *
 * Examples:
 *   /web#id=42&model=sale.order  -> {model: "sale.order", id: 42, action: null}
 *   /odoo/sales/42               -> {model: null, id: 42, action: "sales"}
 *   /odoo/action-123/7           -> {model: null, id: 7, action: 123}
 */
export function parseOdooUrl(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;

  if (url.pathname === "/web" || url.pathname === "/web/") {
    const p = new URLSearchParams(url.hash.slice(1));
    const action = p.get("action");
    return { model: p.get("model"), id: toId(p.get("id")), action: action ? toAction(action) : null };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "odoo") return null;
  let token = null;
  let id = null;
  for (const seg of parts.slice(1)) {
    if (/^\d+$/.test(seg)) id = Number(seg);
    else if (seg === "new") id = null;
    else { token = seg; id = null; }
  }
  if (!token) return { model: null, id: null, action: null };
  if (token.startsWith("action-")) return { model: null, id, action: toAction(token.slice(7)) };
  if (token.includes(".")) return { model: token, id, action: null };
  return { model: null, id, action: token };
}

/**
 * Build the form URL of a record in the same URL style as the current page.
 *
 * @param {string} currentHref - The page the user is on.
 * @param {string} model - Technical model name, e.g. "account.move".
 * @param {number} id - Record id.
 * @returns {string}
 */
export function recordUrl(currentHref, model, id) {
  const url = new URL(currentHref);
  return url.pathname.startsWith("/odoo")
    ? `${url.origin}/odoo/${model}/${id}`
    : `${url.origin}/web#id=${id}&model=${model}&view_type=form`;
}

/**
 * Read the companies picked in Odoo's company switcher.
 * Odoo 17+ keeps them in the "cids" cookie ("2-1"), Odoo 16 in the URL hash ("cids=2,1").
 *
 * @param {string} cookie - document.cookie of the Odoo page.
 * @param {string} hash - location.hash of the Odoo page.
 * @returns {number[]|null} Company ids, the active one first, or null when none is set.
 */
export function companyIds(cookie, hash) {
  const raw = /(?:^|;\s*)cids=([^;]+)/.exec(cookie)?.[1] || new URLSearchParams(hash.replace(/^#/, "")).get("cids");
  const ids = raw ? decodeURIComponent(raw).split(/[-,]/).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  return ids.length ? ids : null;
}

function toId(v) {
  return v && /^\d+$/.test(v) ? Number(v) : null;
}

function toAction(v) {
  return /^\d+$/.test(v) ? Number(v) : v;
}
