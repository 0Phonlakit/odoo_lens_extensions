import { companyIds } from "../lib/odoo-url.js";

const LENS_HEADER = "X-Odoo-Lens";
const LENS_INTERNAL = "-";

/**
 * Run a function inside the Odoo page (MAIN world) and return its result.
 *
 * @param {number} tabId
 * @param {Function} func - Self-contained function; it is serialized into the page.
 * @param {Array} [args]
 * @returns {Promise<*>}
 */
export async function inPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return res ? res.result : undefined;
}

/**
 * Open a client for the Odoo session of the given tab.
 * Calls go through the page's own fetch, so they use the user's login and show up in the page log.
 *
 * @param {number} tabId
 * @returns {Promise<{info: Object, call: Function, fields: Function, canWrite: Function}>}
 * @throws {Error} When the tab is not a logged-in Odoo page.
 */
export async function connect(tabId) {
  let res;
  try {
    res = await inPage(tabId, pageRpc, ["/web/session/get_session_info", {}, null, LENS_HEADER]);
  } catch {
    throw new Error("เข้าถึงหน้านี้ไม่ได้ ลอง reload หน้า Odoo แล้วกดไอคอนอีกครั้ง");
  }
  if (!res || !res.ok) throw new Error(res?.error || "เชื่อมต่อ Odoo ไม่ได้");
  const info = res.result;
  if (!info || !info.uid) throw new Error("ยังไม่ได้ล็อกอิน Odoo ในแท็บนี้");

  const picked = await inPage(tabId, () => {
    const m = /(?:^|;\s*)cids=([^;]+)/.exec(document.cookie);
    return { cookie: m ? `cids=${m[1]}` : "", hash: location.hash };
  }).catch(() => null);
  const current = info.user_companies?.current_company;
  const cids = (picked && companyIds(picked.cookie, picked.hash)) || (current ? [Array.isArray(current) ? current[0] : current] : null);
  const context = { ...info.user_context, ...(cids ? { allowed_company_ids: cids } : {}) };
  const metaCache = new Map();
  const writeCache = new Map();
  let seq = 0;

  async function call(model, method, args = [], kwargs = {}, note = null) {
    const raw = note ? encodeURIComponent(JSON.stringify({ n: `${Date.now()}-${++seq}`, ...note })) : LENS_INTERNAL;
    const params = { model, method, args, kwargs: { ...kwargs, context: { ...context, ...kwargs.context } } };
    const r = await inPage(tabId, pageRpc, [`/web/dataset/call_kw/${model}/${method}`, params, raw, LENS_HEADER]);
    if (!r) throw new Error("หน้าเว็บไม่ตอบ ลอง reload หน้า Odoo");
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }

  async function fields(model) {
    if (!metaCache.has(model)) {
      metaCache.set(model, await call(model, "fields_get", [], {
        attributes: ["string", "type", "relation", "relation_field", "selection", "store", "readonly", "required"]
      }));
    }
    return metaCache.get(model);
  }

  async function canWrite(model) {
    if (!writeCache.has(model)) {
      let ok;
      try { ok = await call(model, "check_access_rights", ["write"], { raise_exception: false }); }
      catch {
        try { ok = await call(model, "has_access", ["write"]); } catch { ok = true; }
      }
      writeCache.set(model, ok !== false);
    }
    return writeCache.get(model);
  }

  return { info, call, fields, canWrite };
}

// Serialized into the page by executeScript: must not reference anything outside its body.
async function pageRpc(route, params, note, header) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (note) headers[header] = note;
    const res = await fetch(route, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: Date.now(), params })
    });
    const j = await res.json();
    if (j.error) {
      const msg = (j.error.data && j.error.data.message) || j.error.message || "Odoo error";
      if (note && window.__odooLens) window.__odooLens.fail(note, msg);
      return { ok: false, error: msg };
    }
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
