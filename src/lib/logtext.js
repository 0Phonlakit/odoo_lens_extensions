const READ_METHODS = new Set([
  "read", "web_read", "search", "search_read", "web_search_read", "search_count", "fields_get",
  "read_group", "web_read_group", "formatted_read_group", "name_search", "web_name_search", "name_get",
  "onchange", "default_get", "get_views", "load_views", "check_access_rights", "has_access",
  "has_group", "read_progress_bar", "web_search_read_unity"
]);
const SEARCH_METHODS = new Set(["search", "search_read", "web_search_read", "search_count", "read_group", "web_read_group", "formatted_read_group"]);
const MAX_VALUE = 60;
const SECRET_FIELD = /pass(wd|word)?|secret|token|api_?key|otp/i;
const MASK = "••••";

/**
 * Build one [label, old, new] change for a log note, hiding secrets and cutting long text.
 *
 * @param {string} field - Technical field name, used to spot secrets.
 * @param {string} label - Field label shown to the user.
 * @param {string|null} oldText - Value before, or null for a new record.
 * @param {string} newText - Value after.
 * @returns {[string, string|null, string]}
 */
export function noteChange(field, label, oldText, newText) {
  const secret = SECRET_FIELD.test(field);
  const show = v => (v == null ? null : secret ? MASK : short(v));
  return [label, show(oldText), show(newText)];
}

/**
 * Turn one captured RPC call into a log line a non-developer can read.
 *
 * @param {{model: string, method: string, ids: number[]|null, vals: Object|null,
 *          preview: string, err: string|null, note: {text: string, changes: Array}|null}} e
 *   One entry recorded by the page hook.
 * @returns {{kind: "read"|"write"|"create"|"delete"|"action"|"error", text: string,
 *            changes: Array<[string, string|null, string]>|null, call: string}}
 *
 * Example:
 *   {model: "sale.order", method: "unlink", ids: [3]}
 *   -> {kind: "delete", text: "ลบ sale.order #3", changes: null, call: "sale.order.unlink()"}
 */
export function describe(e) {
  const kind = e.method === "web_save" ? (e.ids?.length ? "write" : "create") : kindOf(e.method);
  const target = `${e.model}${e.ids?.length ? " " + e.ids.map(id => `#${id}`).join(", ") : ""}`;
  const text = e.note?.text || {
    read: `${SEARCH_METHODS.has(e.method) ? "ค้นหา" : "อ่าน"} ${target}`,
    write: `แก้ไข ${target}`,
    create: `สร้าง ${e.model}`,
    delete: `ลบ ${target}`,
    action: `กดปุ่ม ${e.method} ที่ ${target}`
  }[kind];
  const changes = e.note?.changes
    || (e.vals && (kind === "write" || kind === "create") ? Object.entries(e.vals).map(([k, v]) => [k, null, short(v)]) : null);
  const call = `${e.model}.${e.method}(${e.preview || ""})`;
  if (e.err) return { kind: "error", text: `ผิดพลาด: ${e.err} (${text})`, changes, call };
  return { kind, text, changes, call };
}

function kindOf(method) {
  if (READ_METHODS.has(method)) return "read";
  if (method === "write") return "write";
  if (method === "create") return "create";
  if (method === "unlink") return "delete";
  return "action";
}

function short(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s;
}
