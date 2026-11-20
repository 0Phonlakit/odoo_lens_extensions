export const EDITABLE_TYPES = new Set(["char", "text", "integer", "float", "monetary", "boolean", "date", "datetime", "selection"]);
const NUMBER_TYPES = new Set(["integer", "float", "monetary"]);
const KEYWORDS = { True: true, False: false, None: null, true: true, false: false, null: null };

/**
 * Turn the filter rows of the query builder into an Odoo domain.
 * Rows with an empty value are skipped; values are cast to the field type.
 *
 * @param {{field: string, op: string, value: string}[]} rows
 * @param {Object<string, {type: string}>} meta - Result of fields_get.
 * @returns {Array}
 * @throws {Error} With a Thai message when a value does not fit its field type.
 */
export function buildDomain(rows, meta) {
  return rows
    .filter(r => r.value !== "" && r.value != null)
    .map(r => {
      const m = meta[r.field] || {};
      let v = r.value;
      if (NUMBER_TYPES.has(m.type) || m.type === "date" || m.type === "datetime") v = parseInput(String(v), m);
      else if (m.type === "boolean") v = v === true || v === "true";
      return [r.field, r.op, v];
    });
}

/**
 * Parse a domain written in Python syntax, e.g. "[('state', '=', 'sale')]".
 *
 * @param {string} text
 * @returns {Array}
 * @throws {Error} When the text is not a valid list.
 */
export function parseDomain(text) {
  const src = text.trim();
  if (!src) return [];
  if (src[0] !== "[") throw new Error("domain ต้องเป็น list ที่ขึ้นต้นด้วย [");
  let i = 0;
  const fail = () => { throw new Error("อ่าน domain ไม่ได้ ตรวจวงเล็บและเครื่องหมายคำพูด"); };
  const ws = () => { while (/\s/.test(src[i])) i++; };

  function value() {
    ws();
    const c = src[i];
    if (c === "[" || c === "(") {
      const close = c === "[" ? "]" : ")";
      const out = [];
      i++;
      for (;;) {
        ws();
        if (src[i] === close) { i++; return out; }
        out.push(value());
        ws();
        if (src[i] === ",") i++;
        else if (src[i] !== close) fail();
      }
    }
    if (c === "'" || c === '"') {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        s += src[i++];
      }
      if (src[i] !== c) fail();
      i++;
      return s;
    }
    const m = /^(-?\d+(\.\d+)?|True|False|None|true|false|null)/.exec(src.slice(i));
    if (!m) fail();
    i += m[0].length;
    return m[0] in KEYWORDS ? KEYWORDS[m[0]] : Number(m[0]);
  }

  const out = value();
  ws();
  if (i < src.length) fail();
  return out;
}

/**
 * Print a domain in the Python syntax developers type in Odoo.
 *
 * @param {Array} domain
 * @returns {string} e.g. "[('state', '=', 'sale')]"
 */
export function formatDomain(domain) {
  return `[${domain.map(t => (Array.isArray(t) ? `(${t.map(pyValue).join(", ")})` : pyValue(t))).join(", ")}]`;
}

/**
 * Format a value returned by read/search_read for display.
 *
 * @param {*} v - Raw Odoo value.
 * @param {{type: string, selection?: Array}} meta - Field description.
 * @returns {string}
 */
export function formatValue(v, meta = {}) {
  const type = meta.type;
  if (type === "boolean") return v ? "ใช่" : "ไม่";
  if (v === false || v == null) return "";
  if (type === "many2one") return Array.isArray(v) ? String(v[1]) : String(v.display_name ?? v);
  if (type === "one2many" || type === "many2many") return Array.isArray(v) ? `${v.length} รายการ` : "";
  if (type === "float" || type === "monetary") {
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === "selection") return (meta.selection || []).find(([k]) => k === v)?.[1] ?? String(v);
  if (type === "date") return v.split("-").reverse().join("/");
  if (type === "datetime") return localDateTime(new Date(`${v.replace(" ", "T")}Z`));
  return String(v);
}

/**
 * Turn text typed into a cell back into a value Odoo accepts on write.
 *
 * @param {string} text
 * @param {{type: string}} meta
 * @returns {*}
 * @throws {Error} With a Thai message when the text does not fit the field type.
 */
export function parseInput(text, meta = {}) {
  const s = String(text).trim();
  const type = meta.type;
  if (type === "boolean") return ["true", "1", "yes", "ใช่"].includes(s.toLowerCase());
  if (s === "") return false;
  if (NUMBER_TYPES.has(type)) {
    const n = s.replace(/,/g, "");
    if (!(type === "integer" ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(n)) throw new Error("ต้องเป็นตัวเลข");
    return Number(n);
  }
  if (type === "date") return toIsoDate(s);
  if (type === "datetime") {
    const [d, t = "00:00:00"] = s.split(" ");
    const local = new Date(`${toIsoDate(d)}T${t.length === 5 ? `${t}:00` : t}`);
    if (Number.isNaN(local.getTime())) throw new Error("เวลาต้องเป็น dd/mm/yyyy HH:MM:SS");
    return local.toISOString().slice(0, 19).replace("T", " ");
  }
  return s;
}

/**
 * Format a Date as dd/mm/yyyy HH:MM:SS in local time.
 *
 * @param {Date} d
 * @returns {string}
 */
export function localDateTime(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pyValue(v) {
  if (v === true) return "True";
  if (v === false) return "False";
  if (v == null) return "None";
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(pyValue).join(", ")}]`;
  return String(v);
}

function toIsoDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) throw new Error("วันที่ต้องเป็น dd/mm/yyyy");
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
