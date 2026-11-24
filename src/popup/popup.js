import { parseOdooUrl, recordUrl } from "../lib/odoo-url.js";
import { detectEnv } from "../lib/env.js";
import { buildDomain, parseDomain, formatDomain, formatValue, parseInput, localDateTime, EDITABLE_TYPES } from "../lib/values.js";
import { toCsv } from "../lib/csv.js";
import { describe, noteChange } from "../lib/logtext.js";
import { groupLinks, resolveParent } from "../lib/links.js";
import { connect, inPage } from "./odoo.js";

const PAGE_SIZE = 80;
const EXPORT_LIMIT = 2000;
const LOG_POLL_MS = 2000;
const ID_LIMIT = 500;
const LINE_LIMIT = 200;
const ORIGIN_FIELDS = ["origin", "invoice_origin"];
const ENV_LABEL = { prod: "PRODUCTION", staging: "STAGING", local: "LOCAL" };
const KIND_LABEL = { read: "อ่าน", write: "แก้ไข", create: "สร้าง", delete: "ลบ", action: "กดปุ่ม", error: "ผิดพลาด" };
const LOG_FILTERS = {
  all: ["ทั้งหมด", null],
  change: ["เปลี่ยนข้อมูล", ["write", "create", "delete", "action"]],
  read: ["อ่าน", ["read"]],
  error: ["ผิดพลาด", ["error"]]
};
const OPS = [["=", "เท่ากับ"], ["!=", "ไม่เท่ากับ"], ["ilike", "มีคำว่า"], [">=", "มากกว่าหรือเท่ากับ"], ["<=", "น้อยกว่าหรือเท่ากับ"]];
const DEFAULT_COLS = ["partner_id", "date_order", "invoice_date", "date", "state", "amount_total", "user_id", "product_id", "email", "phone"];
const NUMERIC = new Set(["integer", "float", "monetary"]);
const RELATIONAL = new Set(["many2one", "one2many", "many2many"]);
const SYSTEM_FIELDS = new Set(["id", "display_name", "create_uid", "create_date", "write_uid", "write_date", "__last_update"]);
const NOISY_LINK = /^(message_|activity_|website_message|rating_|__)/;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const money = v => formatValue(v, { type: "monetary" });

const S = {
  tab: null, odoo: null, page: null, env: "prod",
  panel: "data", view: { name: "home", params: {} }, stack: [], data: null,
  q: null, confirming: false, deleting: null, loadSeq: 0, foot: { data: "", log: "" },
  m2oHits: {}, modelNames: new Map(),
  log: null, logFilter: "all", logTimer: null
};

boot();

async function boot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  S.tab = tab;
  S.page = parseOdooUrl(tab?.url || "");
  if (!S.page) return fatal("เปิดหน้า Odoo (หลังบ้าน /web หรือ /odoo) ก่อน แล้วกดไอคอน Odoo Lens อีกครั้ง");
  try {
    S.odoo = await connect(tab.id);
  } catch (e) {
    return fatal(e.message);
  }
  const { db, username } = S.odoo.info;
  const host = new URL(tab.url).hostname;
  S.env = detectEnv(db || "", host);
  $("db-name").textContent = db;
  $("db-tag").textContent = ENV_LABEL[S.env];
  $("db-sub").textContent = `${host} · ${username}`;
  $("db").className = `db ${S.env === "prod" ? "" : S.env}`;
  $("db").hidden = false;
  $("tabs").hidden = false;
  refreshLogCount();
  await refresh();
}

function fatal(message) {
  $("body").innerHTML = `<div class="card"><b>ใช้งานในหน้านี้ไม่ได้</b><span class="muted">${esc(message)}</span></div>`;
}

async function go(name, params = {}) {
  if (S.panel === "log") {
    S.panel = "data";
    clearInterval(S.logTimer);
  }
  S.stack.push(S.view);
  S.view = { name, params: { q: S.q, ...params } };
  S.confirming = false;
  S.deleting = null;
  await refresh();
}

async function back() {
  S.view = S.stack.pop() || { name: "home", params: {} };
  S.confirming = false;
  S.deleting = null;
  await refresh();
}

async function refresh() {
  if (S.panel === "log") return refreshLog(true);
  if (S.view.params.q) S.q = S.view.params.q;
  const v = VIEWS[S.view.name];
  const seq = ++S.loadSeq;
  $("body").innerHTML = `<p class="muted center">กำลังโหลด…</p>`;
  S.foot.data = "";
  showPanel();
  let data;
  try {
    data = v.load ? await v.load(S.view.params) : null;
  } catch (e) {
    if (seq !== S.loadSeq) return;
    $("body").innerHTML = `<div class="card"><b>โหลดข้อมูลไม่สำเร็จ</b><span class="err">${esc(e.message)}</span></div>`;
    return;
  }
  if (seq !== S.loadSeq) return;
  S.data = data;
  paint();
  refreshLogCount();
}

function paint() {
  if (S.panel === "log") {
    const out = logHtml();
    $("log-body").innerHTML = out.body;
    S.foot.log = out.foot || "";
  } else {
    const wrap = document.querySelector("#body .tbl-wrap");
    const scroll = wrap ? [wrap.scrollLeft, wrap.scrollTop] : null;
    const out = VIEWS[S.view.name].html(S.view.params, S.data);
    $("body").innerHTML = out.body;
    S.foot.data = out.foot || "";
    const next = document.querySelector("#body .tbl-wrap");
    if (scroll && next) [next.scrollLeft, next.scrollTop] = scroll;
  }
  showPanel();
}

function showPanel() {
  const log = S.panel === "log";
  $("body").hidden = log;
  $("log-body").hidden = !log;
  $("foot").innerHTML = S.foot[S.panel];
  $("foot").hidden = !S.foot[S.panel];
  $("btn-back").hidden = log || S.view.name === "home";
  $("tab-data").setAttribute("aria-selected", String(!log));
  $("tab-log").setAttribute("aria-selected", String(log));
}

function toast(message, bad = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast${bad ? " bad" : ""}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2500);
}

function debounce(fn, ms = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

const call = (...args) => S.odoo.call(...args);

async function modelName(model) {
  if (!S.modelNames.has(model)) {
    const r = await call("ir.model", "search_read", [[["model", "=", model]], ["name"]], { limit: 1 }).catch(() => []);
    S.modelNames.set(model, r[0]?.name || model);
  }
  return S.modelNames.get(model);
}

async function resolveModel(action) {
  if (action == null) return null;
  try {
    let domain;
    if (typeof action === "number") domain = [["id", "=", action]];
    else if (action.includes(".")) {
      const [module, name] = action.split(".");
      const ref = await call("ir.model.data", "search_read", [[["module", "=", module], ["name", "=", name]], ["res_id"]], { limit: 1 });
      if (!ref.length) return null;
      domain = [["id", "=", ref[0].res_id]];
    } else domain = [["path", "=", action]];
    const r = await call("ir.actions.act_window", "search_read", [domain, ["res_model"]], { limit: 1 });
    return r[0]?.res_model || null;
  } catch {
    return null;
  }
}

async function readOne(model, id, fields) {
  const [rec] = await call(model, "read", [[id], fields]);
  if (!rec) throw new Error(`ไม่พบ ${model} #${id}`);
  return rec;
}

function selLabel(meta, field, value) {
  return formatValue(value, meta[field] || {});
}

function fieldList(meta, test = () => true) {
  return Object.entries(meta)
    .filter(([f, m]) => m.type !== "binary" && test(f, m))
    .sort((a, b) => a[1].string.localeCompare(b[1].string));
}

function isEditable(f, m) {
  return !SYSTEM_FIELDS.has(f) && !m.readonly && (EDITABLE_TYPES.has(m.type) || m.type === "many2one");
}

async function newQuery(model, domain = null) {
  const meta = await S.odoo.fields(model);
  const stored = f => meta[f] && meta[f].store !== false && meta[f].type !== "binary";
  const first = stored("name") ? ["name"] : ["display_name"];
  const cols = [...first, ...DEFAULT_COLS.filter(stored)].slice(0, 5);
  for (const [f] of fieldList(meta, (f, m) => m.store !== false && !RELATIONAL.has(m.type) && !SYSTEM_FIELDS.has(f))) {
    if (cols.length >= 3) break;
    if (!cols.includes(f)) cols.push(f);
  }
  S.q = { model, label: await modelName(model), meta, cols, filters: [], group: "", order: "", offset: 0, domain, edits: new Map() };
}

function currentDomain() {
  return [...(S.q.domain || []), ...buildDomain(S.q.filters, S.q.meta)];
}

async function savedKey() {
  return `saved:${new URL(S.tab.url).origin}|${S.odoo.info.db}`;
}

async function loadSaved() {
  const key = await savedKey();
  return (await chrome.storage.local.get(key))[key] || [];
}

async function storeSaved(list) {
  await chrome.storage.local.set({ [await savedKey()]: list });
}

const VIEWS = {
  home: {
    async load() {
      let ctx = null;
      const p = S.page;
      const model = p.model || await resolveModel(p.action);
      if (model) {
        const rec = p.id ? await readOne(model, p.id, ["display_name"]).catch(() => null) : null;
        ctx = { model, id: rec ? p.id : null, label: await modelName(model), name: rec?.display_name };
      }
      return { ctx, saved: await loadSaved() };
    },
    html(_, { ctx, saved }) {
      const card = ctx ? `
        <div class="card ctx">
          <div class="label">หน้าที่เปิดอยู่</div>
          <div class="title">${esc(ctx.name || ctx.label)} <small>${esc(ctx.model)}${ctx.id ? ` · id ${ctx.id}` : ""}</small></div>
          <div class="row">
            ${ctx.id ? `<button class="btn sm" type="button" data-act="viewRec" data-model="${esc(ctx.model)}" data-id="${ctx.id}">${icon("eye")}ดูทุก field</button>
            <button class="btn sm primary" type="button" data-act="links" data-model="${esc(ctx.model)}" data-id="${ctx.id}">${icon("link")}เอกสารที่เชื่อมกัน</button>` : ""}
            <button class="btn sm" type="button" data-act="openTable" data-model="${esc(ctx.model)}">${icon("table")}ดูเป็นตาราง</button>
          </div>
        </div>` : `<div class="card ctx"><span class="muted">หน้านี้ไม่ได้ผูกกับข้อมูล (model) โดยตรง ค้นหาข้อมูลที่ต้องการด้านล่างได้เลย</span></div>`;
      const list = saved.map((s, i) => `
        <div class="saved">
          <div class="list" style="flex:1"><button type="button" data-act="runSaved" data-i="${i}"><b>${esc(s.title)}</b><span>${esc(s.model)} · ${s.filters.length} เงื่อนไข${s.group ? " · จัดกลุ่ม" : ""}</span></button></div>
          <button class="ibtn danger" type="button" data-act="delSaved" data-i="${i}" title="ลบ query นี้" aria-label="ลบ query ${esc(s.title)}">${icon("trash")}</button>
        </div>`).join("");
      return {
        body: `${card}
          <div class="search">${icon("search")}<input type="text" id="model-search" data-input="searchModel" placeholder="ค้นหาข้อมูล เช่น ใบสั่งขาย, sale.order" aria-label="ค้นหาข้อมูล" autocomplete="off"></div>
          <div class="list" id="model-hits"></div>
          <div><div class="label">Query ที่บันทึกไว้ (${esc(S.odoo.info.db)})</div>${list || `<p class="muted">ยังไม่มี query ที่บันทึกไว้</p>`}</div>`,
        foot: `<button class="btn ghost" type="button" data-act="go" data-view="dev">&lt;/&gt; โหมด dev</button>`
      };
    }
  },

  fields: {
    async load({ model, id }) {
      const meta = await S.odoo.fields(model);
      const names = Object.keys(meta).filter(f => meta[f].type !== "binary");
      const [rec, canWrite, label] = await Promise.all([readOne(model, id, names), S.odoo.canWrite(model), modelName(model)]);
      return { meta, rec, canWrite, label };
    },
    html({ model, id }, { meta, rec, canWrite, label }) {
      const rows = fieldList(meta).map(([f, m]) => `
        <div data-search="${esc(`${m.string} ${f}`.toLowerCase())}"><span>${esc(m.string)}<code>${esc(f)} · ${m.type}</code></span><span>${esc(formatValue(rec[f], m))}</span></div>`).join("");
      return {
        body: `<div class="title">${esc(rec.display_name)} <small>${esc(label)} · ${esc(model)} · id ${id}</small></div>
          <input type="text" data-input="filterRows" data-target="kvs" placeholder="กรอง field…" aria-label="กรอง field">
          <div class="kvs" id="kvs">${rows}</div>`,
        foot: `${canWrite ? `<button class="btn" type="button" data-act="editRec" data-model="${esc(model)}" data-id="${id}">${icon("pencil")}แก้ไข</button>` : ""}
          <button class="btn" type="button" data-act="copyJson">${icon("copy")}คัดลอก JSON</button>
          <button class="btn ghost" type="button" data-act="openRec" data-model="${esc(model)}" data-id="${id}">${icon("external")}เปิดใน Odoo</button>`
      };
    }
  },

  links: {
    load: loadLinks,
    html({ model, id }, { ref, cards, generic, linkError }) {
      const chain = `<div class="chain"><span class="me">${esc(ref)}</span>${cards.length ? "→" : ""}${cards.map(c => `<span>${esc(c.ref)}</span>`).join("")}</div>`;
      const cardHtml = cards.map(c => `
        <div class="card">
          <div class="toolbar"><span class="pill">${esc(c.kind)}</span><span class="sp"></span><span class="muted">${esc(c.status)}${c.amount != null ? ` · ${money(c.amount)}` : ""}</span></div>
          <div class="title">${esc(c.ref)} <small>${esc(c.model)} · id ${c.id}</small></div>
          <div class="via">
            <div class="label">เชื่อมกันที่ field</div>
            <div><code>${esc(c.via[0])}</code> ↔ <code>${esc(c.via[1])}</code></div>
            <div class="muted">รายการอยู่ในใบนี้ผ่าน <code>${esc(c.parentField)}</code></div>
            ${c.table || c.extra ? `<div class="muted">${c.table ? `ตารางกลาง <code>${esc(c.table)}</code> ` : ""}${c.extra ? `อ้างอิงเพิ่ม <code>${esc(c.extra)}</code>` : ""}</div>` : ""}
          </div>
          <div>
            <div class="label">เชื่อมกันที่รายการไหน</div>
            <table class="map"><thead><tr><th>สินค้า / รายการ</th><th class="num">${esc(c.cols[0])}</th><th class="num">${esc(c.cols[1])}</th></tr></thead>
            <tbody>${c.lines.map(([p, a, b]) => `<tr><td>${esc(p)}</td><td class="num">#${a}</td><td class="num">#${b}</td></tr>`).join("")}</tbody></table>
          </div>
          <div class="row">
            <button class="btn sm" type="button" data-act="openRec" data-model="${esc(c.model)}" data-id="${c.id}">${icon("external")}เปิดใน Odoo</button>
            <button class="btn sm" type="button" data-act="copy" data-text="${esc(c.ref)}">${icon("copy")}เลขที่</button>
            <button class="btn sm" type="button" data-act="copy" data-text="${esc(c.domain)}">${icon("copy")}domain</button>
          </div>
        </div>`).join("");
      const genericHtml = generic.map(g => `
        <button type="button" data-act="${g.type === "many2one" ? "viewRec" : "openIds"}" data-model="${esc(g.relation)}" data-id="${g.ids[0]}" data-ids="${g.ids.join(",")}">
          <b>${esc(g.label)}</b><span><code>${esc(model)}.${esc(g.field)}</code> → ${esc(g.relation)} · ${esc(g.text)}</span>
        </button>`).join("");
      return {
        body: `<div class="title">${esc(ref)} เชื่อมกับ ${cards.length} เอกสาร <small>${esc(model)} · id ${id}</small></div>
          ${linkError ? `<div class="card"><b>หาเอกสารที่เชื่อมผ่านรายการไม่สำเร็จ</b><span class="err">${esc(linkError)}</span></div>` : ""}
          ${cards.length ? chain : ""}${cardHtml}
          <div><div class="label">ทุก field ที่ผูกกับข้อมูลอื่น (${generic.length})</div>
          <input type="text" data-input="filterRows" data-target="rel-list" placeholder="กรอง…" aria-label="กรอง field ที่ผูกกัน">
          <div class="list" id="rel-list">${genericHtml || `<p class="muted">ไม่มี</p>`}</div></div>`
      };
    }
  },

  builder: {
    html() {
      const q = S.q;
      const searchable = fieldList(q.meta, (f, m) => m.store !== false);
      const fieldOpts = sel => searchable.map(([f, m]) => `<option value="${esc(f)}"${f === sel ? " selected" : ""}>${esc(m.string)}</option>`).join("");
      const opOpts = sel => OPS.map(([k, l]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
      const filters = q.filters.map((r, i) => `
        <div class="filter">
          <select data-change="filter" data-i="${i}" data-k="field" aria-label="field">${fieldOpts(r.field)}</select>
          <select data-change="filter" data-i="${i}" data-k="op" aria-label="เงื่อนไข">${opOpts(r.op)}</select>
          ${valueControl(q.meta[r.field], r.value, `data-change="filter" data-i="${i}" data-k="value"`)}
          <button class="ibtn danger" type="button" data-act="rmFilter" data-i="${i}" aria-label="ลบเงื่อนไข">${icon("x")}</button>
        </div>`).join("");
      const groupable = fieldList(q.meta, (f, m) => m.store !== false && ["many2one", "selection", "date", "datetime", "char", "boolean"].includes(m.type));
      const base = q.domain ? `<div class="card ctx"><span class="muted">เงื่อนไขตั้งต้น (จากโหมด dev หรือลิงก์): <code>${esc(formatDomain(q.domain))}</code></span>
        <div><button class="btn sm ghost" type="button" data-act="clearBaseDomain">${icon("x")}ล้างเงื่อนไขตั้งต้น</button></div></div>` : "";
      return {
        body: `<div class="title">${esc(q.label)} <small>${esc(q.model)}</small></div>${base}
          <div class="field"><span>แสดง field</span>
            <input type="text" data-input="colFilter" placeholder="หา field…" aria-label="หา field">
            <div class="chips" id="col-chips">${chipsHtml("")}</div></div>
          <div class="field"><span>เงื่อนไข (ต้องตรงทุกข้อ)</span>${filters}
            <div><button class="btn ghost sm" type="button" data-act="addFilter">${icon("plus")}เพิ่มเงื่อนไข</button></div></div>
          <label class="field"><span>จัดกลุ่มตาม</span><select data-change="group"><option value="">ไม่จัดกลุ่ม</option>
            ${groupable.map(([f, m]) => `<option value="${esc(f)}"${f === q.group ? " selected" : ""}>${esc(m.string)}</option>`).join("")}</select></label>
          <div class="row"><input type="text" id="save-title" placeholder="ตั้งชื่อเพื่อบันทึก query นี้" style="flex:1" aria-label="ชื่อ query"><button class="btn sm" type="button" data-act="saveQuery">บันทึก</button></div>
          <div class="muted">Domain: <code>${esc(formatDomain(currentDomain()))}</code></div>`,
        foot: `<button class="btn primary" type="button" data-act="runQuery">${icon("search")}ดูผลลัพธ์</button>`
      };
    }
  },

  dev: {
    html() {
      const q = S.q;
      return {
        body: `<div class="muted">โหมด dev: เขียน domain และ field เอง (ผ่าน ORM ของ Odoo ไม่ใช่ SQL)</div>
          <label class="field"><span>Model</span><input type="text" id="dev-model" value="${esc(q?.model || "")}" placeholder="sale.order"></label>
          <label class="field"><span>Domain</span><textarea id="dev-domain" placeholder="[('state', '=', 'sale')]">${esc(q ? formatDomain(currentDomain()) : "")}</textarea></label>
          <label class="field"><span>Fields (คั่นด้วย ,)</span><input type="text" id="dev-fields" value="${esc(q?.cols.join(", ") || "")}" placeholder="name, partner_id, amount_total"></label>`,
        foot: `<button class="btn primary" type="button" data-act="runDev">${icon("search")}รัน search_read</button><span class="muted">${PAGE_SIZE} แถวต่อหน้า</span>`
      };
    }
  },

  results: {
    async load() {
      const q = S.q;
      const domain = currentDomain();
      if (q.group) {
        const sums = q.cols.filter(f => NUMERIC.has(q.meta[f]?.type) && q.meta[f].store !== false);
        const rows = await call(q.model, "read_group", [], { domain, fields: sums.map(f => `${f}:sum`), groupby: [q.group], lazy: true });
        return { grouped: true, rows, sums };
      }
      const kw = { domain, fields: q.cols, limit: PAGE_SIZE, offset: q.offset };
      if (q.order) kw.order = q.order;
      const [rows, total, canWrite] = await Promise.all([
        call(q.model, "search_read", [], kw),
        call(q.model, "search_count", [domain]),
        S.odoo.canWrite(q.model)
      ]);
      return { rows, total, canWrite };
    },
    html(_, data) {
      const q = S.q;
      const tools = `<div class="toolbar"><b>${esc(q.label)}</b><span class="sp"></span>
        ${data.canWrite && !data.grouped ? `<button class="btn sm primary" type="button" data-act="newRec" data-model="${esc(q.model)}">${icon("plus")}สร้าง</button>` : ""}
        <button class="ibtn" type="button" data-act="reload" title="โหลดใหม่" aria-label="โหลดใหม่">${icon("refresh")}</button>
        <button class="ibtn" type="button" data-act="go" data-view="builder" title="กรอง / แก้เงื่อนไข" aria-label="กรอง">${icon("filter")}</button></div>`;
      if (data.grouped) return { body: tools + groupedTable(data), foot: exportFoot() };
      const from = data.total ? q.offset + 1 : 0;
      const to = q.offset + data.rows.length;
      const pager = `<div class="toolbar"><span class="muted">${from}–${to} จาก ${data.total} แถว</span><span class="sp"></span>
        <button class="btn sm" type="button" data-act="page" data-dir="-1"${q.offset ? "" : " disabled"}>ก่อนหน้า</button>
        <button class="btn sm" type="button" data-act="page" data-dir="1"${to < data.total ? "" : " disabled"}>ถัดไป</button></div>`;
      return { body: tools + pager + rowsTable(data) + deleteBar(data) + saveBar(data), foot: exportFoot() };
    }
  },

  form: {
    async load({ model, id }) {
      const meta = await S.odoo.fields(model);
      const required = Object.keys(meta).filter(f => meta[f].required && isEditable(f, meta[f]));
      const fromQuery = S.q?.model === model ? S.q.cols : ["name"];
      const names = [...new Set(id ? [...fromQuery, ...required] : [...required, ...fromQuery])].filter(f => meta[f] && isEditable(f, meta[f]));
      const values = id ? await readOne(model, id, [...names, "display_name"]) : await call(model, "default_get", [names]);
      for (const f of names) {
        if (meta[f].type === "many2one" && Number.isInteger(values[f])) values[f] = [values[f], `#${values[f]}`];
      }
      S.m2oHits = {};
      return { meta, names, values, label: await modelName(model) };
    },
    html({ model, id }, { meta, names, values, label }) {
      const inputs = names.map(f => {
        const m = meta[f];
        const req = m.required ? " *" : "";
        if (m.type === "many2one") {
          const v = values[f];
          return `<label class="field"><span>${esc(m.string)}${req}</span>
            <input type="text" list="dl-${esc(f)}" data-f="${esc(f)}" data-input="m2o" data-change="m2oPick" data-rel="${esc(m.relation)}" data-id="${v ? v[0] : ""}" value="${esc(v ? v[1] : "")}" autocomplete="off">
            <datalist id="dl-${esc(f)}"></datalist></label>`;
        }
        if (m.type === "date") {
          return `<label class="field"><span>${esc(m.string)}${req}</span><input type="date" data-f="${esc(f)}" value="${esc(values[f] || "")}"></label>`;
        }
        return `<label class="field"><span>${esc(m.string)}${req}</span>${valueControl(m, rawToText(values[f], m), `data-f="${esc(f)}"`)}</label>`;
      }).join("");
      return {
        body: `<div class="title">${icon(id ? "pencil" : "plus")} ${id ? `แก้ไข ${esc(values.display_name || `#${id}`)}` : `สร้าง${esc(label)}`} <small>${esc(model)}</small></div>
          <div id="form" style="display:grid;gap:8px">${inputs || `<p class="muted">ไม่มี field ที่แก้ไขได้</p>`}</div>
          <div class="err" id="form-err" hidden></div>
          <div class="muted">บันทึกผ่าน <code>${esc(model)}.${id ? "write" : "create"}()</code> ของ Odoo</div>`,
        foot: `<button class="btn primary" type="button" data-act="saveForm" data-model="${esc(model)}" data-id="${id || ""}">${icon("check")}บันทึก</button>
          <button class="btn ghost" type="button" data-act="back">${icon("x")}ยกเลิก</button>`
      };
    }
  },

  password: {
    html() {
      const { db, username } = S.odoo.info;
      return {
        body: `<div class="title">เปลี่ยนรหัสผ่าน</div>
          <div class="card ctx"><div class="kvs"><div><span class="muted">Database</span><span><code>${esc(db)}</code></span></div>
            <div style="border:0"><span class="muted">User</span><span>${esc(username)}</span></div></div></div>
          <input type="text" value="${esc(username)}" autocomplete="username" hidden>
          <label class="field"><span>รหัสผ่านปัจจุบัน</span><input type="password" id="pw-old" autocomplete="current-password"></label>
          <label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</span><input type="password" id="pw-new" autocomplete="new-password"></label>
          <label class="field"><span>ยืนยันรหัสผ่านใหม่</span><input type="password" id="pw-confirm" autocomplete="new-password" data-enter="changePassword"></label>
          <label class="row muted"><input type="checkbox" data-change="showPassword"> แสดงรหัสผ่าน</label>
          <div class="err" id="pw-err" hidden></div>
          <div class="muted">เปลี่ยนเฉพาะ user นี้ใน DB <b>${esc(db)}</b> ผ่าน <code>res.users.change_password</code> · Odoo Lens ไม่เก็บรหัสผ่าน</div>`,
        foot: `<button class="btn primary" type="button" data-act="changePassword">${icon("check")}บันทึกรหัสผ่านใหม่</button>
          <button class="btn ghost" type="button" data-act="back">${icon("x")}ยกเลิก</button>`
      };
    }
  }
};

function valueControl(m = {}, value, attrs) {
  if (m.type === "selection" || m.type === "boolean") {
    const opts = m.type === "boolean" ? [["true", "ใช่"], ["false", "ไม่"]] : [["", ""], ...m.selection];
    return `<select ${attrs}>${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }
  return `<input type="text" ${attrs} value="${esc(value)}" placeholder="ค่า">`;
}

function rawToText(v, m) {
  if (m.type === "selection") return v || "";
  if (m.type === "boolean") return String(Boolean(v));
  if (NUMERIC.has(m.type)) return v === false || v == null ? "" : String(v);
  return formatValue(v, m);
}

function chipsHtml(filterText) {
  const q = S.q;
  const t = filterText.toLowerCase();
  const all = fieldList(q.meta, (f, m) => m.store !== false || f === "display_name");
  const picked = q.cols.map(f => [f, q.meta[f]]).filter(([, m]) => m);
  const others = all.filter(([f, m]) => !q.cols.includes(f) && (!t || `${m.string} ${f}`.toLowerCase().includes(t))).slice(0, 40);
  return [...picked, ...others].map(([f, m]) =>
    `<button class="chip" type="button" data-act="toggleCol" data-f="${esc(f)}" aria-pressed="${q.cols.includes(f)}" title="${esc(f)}">${esc(m.string)}</button>`).join("");
}

function rowsTable({ rows, canWrite }) {
  const q = S.q;
  const [sortField, sortDir] = q.order.split(" ");
  const head = q.cols.map(f => {
    const m = q.meta[f] || {};
    const arrow = sortField === f ? (sortDir === "desc" ? " ▼" : " ▲") : "";
    return `<th data-act="sort" data-f="${esc(f)}" title="${esc(f)}"${NUMERIC.has(m.type) ? ' class="num"' : ""}>${esc(m.string || f)}${arrow}</th>`;
  }).join("");
  const body = rows.map(r => `<tr>${q.cols.map((f, i) => cellHtml(r, f, i, canWrite)).join("")}
    <td class="act"><button class="ibtn" type="button" data-act="viewRec" data-model="${esc(q.model)}" data-id="${r.id}" title="ดูรายละเอียด" aria-label="ดูรายละเอียด">${icon("eye")}</button>${canWrite
      ? `<button class="ibtn" type="button" data-act="editRec" data-model="${esc(q.model)}" data-id="${r.id}" title="แก้ไข" aria-label="แก้ไข">${icon("pencil")}</button><button class="ibtn danger" type="button" data-act="askDelete" data-id="${r.id}" title="ลบ" aria-label="ลบ">${icon("trash")}</button>` : ""}</td></tr>`).join("");
  return `<div class="tbl-wrap"><table class="grid"><thead><tr>${head}<th class="act">จัดการ</th></tr></thead><tbody>${body || `<tr><td colspan="${q.cols.length + 1}"><span class="muted">ไม่พบข้อมูล</span></td></tr>`}</tbody></table></div>`;
}

function cellHtml(row, f, index, canWrite) {
  const m = S.q.meta[f] || {};
  const pending = S.q.edits.get(row.id)?.[f];
  const num = NUMERIC.has(m.type) ? " num" : "";
  if (index === 0) return `<td class="${num}"><a data-act="openRec" data-model="${esc(S.q.model)}" data-id="${row.id}" title="เปิดใน Odoo">${esc(formatValue(row[f], m) || `#${row.id}`)}</a></td>`;
  if (!canWrite || !isEditable(f, m) || m.type === "many2one" || m.store === false) {
    return `<td class="${num}"><span>${esc(formatValue(row[f], m))}</span></td>`;
  }
  const attrs = `data-change="cell" data-id="${row.id}" data-f="${esc(f)}" aria-label="${esc(m.string)}"`;
  const value = pending ? pending.input : rawToText(row[f], m);
  return `<td class="edit${pending ? " dirty" : ""}${num}">${valueControl(m, value, attrs)}</td>`;
}

function groupedTable({ rows, sums }) {
  const q = S.q;
  const gm = q.meta[q.group];
  const head = `<th>${esc(gm.string)}</th><th class="num">จำนวน</th>${sums.map(f => `<th class="num">${esc(q.meta[f].string)}</th>`).join("")}`;
  const body = rows.map(r => {
    const key = r[q.group];
    const label = Array.isArray(key) ? key[1] : gm.type === "selection" ? selLabel(q.meta, q.group, key) : key === false ? "(ว่าง)" : key;
    const count = r[`${q.group}_count`] ?? r.__count ?? "";
    return `<tr><td><span>${esc(label)}</span></td><td class="num"><span>${count}</span></td>${sums.map(f => `<td class="num"><span>${esc(formatValue(r[f], q.meta[f]))}</span></td>`).join("")}</tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function deleteBar({ rows }) {
  if (!S.deleting) return "";
  const r = rows.find(x => x.id === S.deleting.id);
  const name = esc(formatValue(r?.[S.q.cols[0]], S.q.meta[S.q.cols[0]]) || `#${S.deleting.id}`);
  if (S.deleting.error) {
    return `<div class="bar del"><b>ลบ ${name} ไม่ได้</b><span class="err">${esc(S.deleting.error)}</span><div class="row"><button class="btn sm" type="button" data-act="cancelDelete">ตกลง</button></div></div>`;
  }
  return `<div class="bar del"><b>ลบ ${name} ถาวร?</b><span class="muted">ย้อนกลับไม่ได้ · เรียก <code>${esc(S.q.model)}.unlink()</code></span>
    <div class="row"><button class="btn sm danger" type="button" data-act="doDelete">${icon("trash")}ลบ</button><button class="btn sm" type="button" data-act="cancelDelete">${icon("x")}ยกเลิก</button></div></div>`;
}

function saveBar() {
  const changes = [...S.q.edits.entries()].flatMap(([id, fs]) => Object.entries(fs).map(([f, e]) => ({ id, f, ...e })));
  if (!changes.length) return "";
  if (!S.confirming) {
    return `<div class="bar save"><div class="toolbar"><span>แก้ไข ${changes.length} ช่อง ยังไม่ได้บันทึก</span><span class="sp"></span>
      <button class="btn sm" type="button" data-act="discard">${icon("x")}ยกเลิก</button><button class="btn sm primary" type="button" data-act="askSave">${icon("check")}บันทึก…</button></div></div>`;
  }
  return `<div class="bar save"><b>ยืนยันการแก้ไข ${S.q.edits.size} แถว${S.env === "prod" ? " ใน PRODUCTION" : ""}</b>
    <div class="diff">${changes.map(c => `<div>#${c.id} · ${esc(S.q.meta[c.f].string)}: <del>${esc(c.oldText)}</del> → <ins>${esc(c.text)}</ins></div>`).join("")}</div>
    <span class="muted">เรียก <code>${esc(S.q.model)}.write()</code> ทีละแถว</span>
    <div class="row"><button class="btn sm primary" type="button" data-act="doSave">${icon("check")}ยืนยันบันทึก</button><button class="btn sm" type="button" data-act="cancelSave">กลับไปแก้</button></div></div>`;
}

function exportFoot() {
  return `<button class="btn" type="button" data-act="exportCsv">${icon("download")}Export CSV (Excel)</button>`;
}

async function loadLinks({ model, id }) {
  const meta = await S.odoo.fields(model);
  const rel = Object.entries(meta).filter(([f, m]) => RELATIONAL.has(m.type) && !NOISY_LINK.test(f) && !SYSTEM_FIELDS.has(f));
  const rec = await readOne(model, id, ["display_name", ...rel.map(([f]) => f)]);
  const generic = rel
    .filter(([f]) => rec[f] && (!Array.isArray(rec[f]) || rec[f].length))
    .map(([f, m]) => {
      const many = m.type !== "many2one";
      const ids = many ? rec[f].slice(0, ID_LIMIT) : [rec[f][0]];
      return { field: f, label: m.string, type: m.type, relation: m.relation, ids, text: many ? `${rec[f].length} รายการ` : rec[f][1] };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  let cards = [];
  let linkError = "";
  try {
    cards = await documentLinks(model, id, rec, meta);
  } catch (e) {
    linkError = e.message;
  }
  return { ref: rec.display_name, cards, generic, linkError };
}

/**
 * Find documents linked to this one through their lines, for any model.
 * Walks: this document's line lists (one2many) -> each line field pointing to another model's line
 * -> the document that line belongs to (a one2many on a model that has a "state" field).
 */
async function documentLinks(model, id, rec, meta) {
  const lineFields = Object.entries(meta).filter(([f, m]) => m.type === "one2many" && !NOISY_LINK.test(f) && rec[f]?.length);
  if (!lineFields.length) return [];
  const lineModels = [...new Set(lineFields.map(([, m]) => m.relation))];
  const FIELD_INFO = ["model", "name", "ttype", "relation", "relation_field", "relation_table"];
  const lineRel = await call("ir.model.fields", "search_read", [[["model", "in", lineModels], ["ttype", "in", [...RELATIONAL]]], FIELD_INFO]);
  const links = lineRel.filter(f => f.relation !== model && f.relation !== f.model && !NOISY_LINK.test(f.name) && !SYSTEM_FIELDS.has(f.name));
  const targets = [...new Set(links.map(f => f.relation))];
  if (!targets.length) return [];

  const parentO2m = await call("ir.model.fields", "search_read", [[["ttype", "=", "one2many"], ["relation", "in", targets], ["model", "!=", model]], FIELD_INFO]);
  const docModels = new Set((await call("ir.model.fields", "search_read", [[["model", "in", [...new Set(parentO2m.map(f => f.model))]], ["name", "=", "state"]], ["model"]])).map(f => f.model));
  const parentsOf = new Map();
  for (const f of parentO2m) {
    if (!docModels.has(f.model) || !f.relation_field) continue;
    const list = parentsOf.get(f.relation) || [];
    if (!list.some(c => c.model === f.model && c.field === f.relation_field)) list.push({ model: f.model, field: f.relation_field, o2m: f.name });
    parentsOf.set(f.relation, list);
  }
  const useful = links.filter(f => parentsOf.has(f.relation));
  if (!useful.length) return [];
  const targetRel = await call("ir.model.fields", "search_read", [[["model", "in", [...new Set(useful.map(f => f.relation))]], ["relation", "in", lineModels]], FIELD_INFO]);

  const raw = [];
  for (const [lf, lm] of lineFields) {
    const fs = useful.filter(f => f.model === lm.relation);
    if (!fs.length) continue;
    const lineMeta = await S.odoo.fields(lm.relation);
    const labelField = lineMeta.product_id ? "product_id" : lineMeta.name ? "name" : "display_name";
    const lines = await call(lm.relation, "read", [rec[lf].slice(0, LINE_LIMIT), [labelField, ...fs.map(f => f.name)]]);
    for (const l of lines) {
      const label = Array.isArray(l[labelField]) ? l[labelField][1] : l[labelField] || `#${l.id}`;
      for (const f of fs) {
        const v = l[f.name];
        for (const other of Array.isArray(v) ? (f.ttype === "many2one" ? [v[0]] : v) : v ? [v] : []) {
          raw.push({ field: f, own: l.id, other, label, ownParentField: lm.relation_field });
        }
      }
    }
  }
  if (!raw.length) return [];

  const parentOfLine = new Map();
  for (const t of new Set(raw.map(r => r.field.relation))) {
    const candidates = parentsOf.get(t);
    const ids = [...new Set(raw.filter(r => r.field.relation === t).map(r => r.other))];
    for (const r of await call(t, "read", [ids, candidates.map(c => c.field)])) {
      const p = resolveParent(candidates, r);
      if (p) parentOfLine.set(`${t}|${r.id}`, { ...p, o2m: candidates.find(c => c.field === p.field).o2m });
    }
  }

  const pairs = [];
  const linkOf = new Map();
  for (const r of raw) {
    const p = parentOfLine.get(`${r.field.relation}|${r.other}`);
    if (!p || (p.model === model && p.id === id)) continue;
    const via = `${r.field.model}.${r.field.name}`;
    linkOf.set(via, { f: r.field, parent: p, ownParentField: r.ownParentField });
    pairs.push({ parentModel: p.model, parentId: p.id, via, label: r.label, own: r.own, other: r.other });
  }
  const groups = groupLinks(pairs).sort((a, b) => a.parentModel.localeCompare(b.parentModel));

  const docs = new Map();
  for (const pm of new Set(groups.map(g => g.parentModel))) {
    const pmeta = await S.odoo.fields(pm);
    const extra = ORIGIN_FIELDS.filter(f => pmeta[f]);
    const fieldsToRead = ["display_name", "state", ...(pmeta.amount_total ? ["amount_total"] : []), ...extra];
    const ids = [...new Set(groups.filter(g => g.parentModel === pm).map(g => g.parentId))];
    for (const d of await call(pm, "read", [ids, fieldsToRead])) docs.set(`${pm}|${d.id}`, { ...d, pmeta, extra, label: await modelName(pm) });
  }

  return groups.map(g => {
    const d = docs.get(`${g.parentModel}|${g.parentId}`);
    const { f, parent, ownParentField } = linkOf.get(g.via);
    const inverse = inverseField(f, targetRel);
    const origin = d.extra.find(x => d[x]);
    const path = inverse && ownParentField ? `${parent.o2m}.${inverse}.${ownParentField}` : null;
    return {
      kind: d.label, model: g.parentModel, id: g.parentId, ref: d.display_name,
      status: selLabel(d.pmeta, "state", d.state), amount: d.amount_total ?? null,
      via: [g.via, inverse ? `${f.relation}.${inverse}` : f.relation], parentField: `${f.relation}.${parent.field}`,
      table: f.ttype === "many2many" ? f.relation_table : "", extra: origin ? `${origin} = "${d[origin]}"` : "",
      cols: [f.model, f.relation], lines: g.lines,
      domain: path ? formatDomain([[path, "=", id]]) : formatDomain([["id", "in", [g.parentId]]])
    };
  });
}

function inverseField(f, targetRel) {
  const onTarget = targetRel.filter(t => t.model === f.relation && t.relation === f.model);
  if (f.ttype === "one2many") return f.relation_field || null;
  if (f.ttype === "many2many") return onTarget.find(t => t.ttype === "many2many" && t.relation_table === f.relation_table)?.name || null;
  return onTarget.find(t => t.ttype === "one2many" && t.relation_field === f.name)?.name || null;
}

async function readPageLog() {
  return inPage(S.tab.id, () => (window.__odooLens ? { startedAt: window.__odooLens.startedAt, entries: window.__odooLens.entries() } : null));
}

async function refreshLogCount() {
  const log = await readPageLog().catch(() => null);
  $("log-count").textContent = log ? log.entries.length : "–";
}

async function refreshLog(force = false) {
  const log = await readPageLog().catch(() => null);
  const last = S.log?.entries.at(-1);
  const changed = force || !log !== !S.log || log?.entries.length !== S.log?.entries.length || log?.entries.at(-1)?.t !== last?.t || log?.entries.at(-1)?.err !== last?.err;
  S.log = log;
  $("log-count").textContent = log ? log.entries.length : "–";
  if (changed && S.panel === "log") paint();
}

function logHtml() {
  if (!S.log) {
    return { body: `<div class="card"><b>ยังไม่ได้เริ่มบันทึกในหน้านี้</b><span class="muted">reload หน้า Odoo หนึ่งครั้งหลังติดตั้ง Odoo Lens แล้ว log จะเริ่มบันทึก</span></div>` };
  }
  const items = S.log.entries.map(describeEntry).reverse();
  const kinds = LOG_FILTERS[S.logFilter][1];
  const shown = items.filter(l => !kinds || kinds.includes(l.kind));
  const chips = Object.entries(LOG_FILTERS).map(([k, [label, ks]]) =>
    `<button class="chip" type="button" data-act="logFilter" data-f="${k}" aria-pressed="${k === S.logFilter}">${label} ${items.filter(l => !ks || ks.includes(l.kind)).length}</button>`).join("");
  const list = shown.map(l => `
    <div class="log k-${l.kind}">
      <div class="log-head"><span class="t">${esc(l.time)}</span><b>${KIND_LABEL[l.kind]}</b><span>${l.ms} ms</span><span class="src">${l.src === "lens" ? "Odoo Lens" : "Odoo"}</span></div>
      <div class="txt">${esc(l.text)}</div>
      ${l.changes ? `<div class="diff">${l.changes.map(([f, a, b]) => `<div>${esc(f)}: ${a != null ? `<del>${esc(a)}</del> → ` : ""}<ins>${esc(b)}</ins></div>`).join("")}</div>` : ""}
      <details><summary>รายละเอียดทางเทคนิค</summary><code>${esc(l.call)}</code></details>
    </div>`).join("");
  return {
    body: `<div class="muted">บันทึกตั้งแต่โหลดหน้า ${localDateTime(new Date(S.log.startedAt))} · reload หน้าเว็บแล้ว log จะถูกล้าง</div>
      <div class="chips">${chips}</div>
      <div style="display:grid;gap:6px">${list || `<p class="muted center">ยังไม่มีรายการในกลุ่มนี้</p>`}</div>`,
    foot: `<button class="btn" type="button" data-act="copyLog">${icon("copy")}คัดลอก log</button>
      <button class="btn ghost" type="button" data-act="clearLog">${icon("trash")}ล้าง log</button>`
  };
}

function describeEntry(e) {
  const d = new Date(e.t);
  return { ...describe(e), time: localDateTime(d).slice(11), date: localDateTime(d), ms: e.ms, src: e.src };
}

const ACT = {
  back,
  go: d => go(d.view),
  reload: () => refresh(),
  async panel(d) {
    S.panel = d.panel;
    clearInterval(S.logTimer);
    if (S.panel === "log") {
      S.logTimer = setInterval(() => refreshLog(), LOG_POLL_MS);
      await refreshLog(true);
    } else showPanel();
  },
  links: d => go("links", { model: d.model, id: Number(d.id) }),
  viewRec: d => go("fields", { model: d.model, id: Number(d.id) }),
  editRec: d => go("form", { model: d.model, id: Number(d.id) }),
  newRec: d => go("form", { model: d.model, id: null }),
  openRec: d => chrome.tabs.create({ url: recordUrl(S.tab.url, d.model, Number(d.id)) }),
  async openTable(d) { await newQuery(d.model); await go("results"); },
  async openIds(d) { await newQuery(d.model, [["id", "in", d.ids.split(",").map(Number)]]); await go("results"); },
  async pickModel(d) { await newQuery(d.model); await go("builder"); },
  async runSaved(d) {
    const s = (await loadSaved())[Number(d.i)];
    await newQuery(s.model);
    Object.assign(S.q, { cols: s.cols, filters: s.filters, group: s.group, domain: s.domain || null });
    await go("results");
  },
  async delSaved(d) {
    const list = await loadSaved();
    const [gone] = list.splice(Number(d.i), 1);
    await storeSaved(list);
    toast(`ลบ query "${gone.title}" แล้ว`);
    await refresh();
  },
  async saveQuery() {
    const title = $("save-title").value.trim();
    if (!title) return toast("ตั้งชื่อ query ก่อนบันทึก", true);
    const list = await loadSaved();
    list.push({ title, model: S.q.model, cols: S.q.cols, filters: S.q.filters, group: S.q.group, domain: S.q.domain });
    await storeSaved(list);
    toast(`บันทึก query "${title}" แล้ว`);
  },
  toggleCol(d) {
    const q = S.q;
    q.cols = q.cols.includes(d.f) ? q.cols.filter(f => f !== d.f) : [...q.cols, d.f];
    if (!q.cols.length) q.cols = [d.f];
    $("col-chips").innerHTML = chipsHtml(document.querySelector("[data-input=colFilter]").value);
  },
  addFilter() {
    const first = fieldList(S.q.meta, (f, m) => m.store !== false && ["char", "many2one"].includes(m.type))[0]?.[0] || "id";
    S.q.filters.push({ field: S.q.meta.name ? "name" : first, op: "ilike", value: "" });
    paint();
  },
  rmFilter(d) { S.q.filters.splice(Number(d.i), 1); paint(); },
  async runQuery() { currentDomain(); S.q.offset = 0; S.q.edits.clear(); await go("results"); },
  clearBaseDomain() { S.q.domain = null; paint(); },
  async runDev() {
    const model = $("dev-model").value.trim();
    if (!model) return toast("ใส่ชื่อ model ก่อน", true);
    const domain = parseDomain($("dev-domain").value);
    const cols = $("dev-fields").value.split(",").map(s => s.trim()).filter(Boolean);
    await newQuery(model, domain);
    if (cols.length) S.q.cols = cols;
    await go("results");
  },
  async page(d) {
    if (S.q.edits.size) return toast("บันทึกหรือยกเลิกการแก้ไขก่อนเปลี่ยนหน้า", true);
    S.q.offset = Math.max(0, S.q.offset + Number(d.dir) * PAGE_SIZE);
    await refresh();
  },
  async sort(d) {
    if (S.q.edits.size) return toast("บันทึกหรือยกเลิกการแก้ไขก่อนเรียงลำดับใหม่", true);
    const [f, dir] = S.q.order.split(" ");
    S.q.order = `${d.f} ${f === d.f && dir === "asc" ? "desc" : "asc"}`;
    S.q.offset = 0;
    await refresh();
  },
  askDelete(d) { S.deleting = { id: Number(d.id), error: null }; S.confirming = false; paint(); },
  cancelDelete() { S.deleting = null; paint(); },
  async doDelete(d, btn) {
    btn.disabled = true;
    const { id } = S.deleting;
    const row = S.data.rows.find(r => r.id === id);
    const name = formatValue(row?.[S.q.cols[0]], S.q.meta[S.q.cols[0]]) || `#${id}`;
    try {
      await call(S.q.model, "unlink", [[id]], {}, { text: `ลบ ${S.q.label} ${name}` });
    } catch (e) {
      S.deleting.error = e.message;
      return paint();
    }
    S.deleting = null;
    S.q.edits.delete(id);
    if (S.data.rows.length === 1 && S.q.offset) S.q.offset = Math.max(0, S.q.offset - PAGE_SIZE);
    toast(`ลบ ${name} แล้ว`);
    await refresh();
  },
  discard() { S.q.edits.clear(); S.confirming = false; paint(); },
  askSave() { S.confirming = true; S.deleting = null; paint(); },
  cancelSave() { S.confirming = false; paint(); },
  async doSave(d, btn) {
    btn.disabled = true;
    const failed = [];
    for (const [id, fs] of S.q.edits) {
      const row = S.data.rows.find(r => r.id === id);
      const name = formatValue(row?.[S.q.cols[0]], S.q.meta[S.q.cols[0]]) || `#${id}`;
      const vals = Object.fromEntries(Object.entries(fs).map(([f, e]) => [f, e.value]));
      const changes = Object.entries(fs).map(([f, e]) => noteChange(f, S.q.meta[f].string, e.oldText, e.text));
      try {
        await call(S.q.model, "write", [[id], vals], {}, { text: `แก้ไข ${name} (${changes.length} field)`, changes });
        S.q.edits.delete(id);
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    }
    S.confirming = false;
    if (failed.length) toast(`บันทึกไม่สำเร็จ ${failed.length} แถว — ${failed[0]}`, true);
    else toast("บันทึกแล้ว");
    await refresh();
  },
  async saveForm(d, btn) {
    const model = d.model;
    const id = d.id ? Number(d.id) : null;
    const { meta, values } = S.data;
    const err = $("form-err");
    const vals = {};
    const changes = [];
    try {
      for (const el of document.querySelectorAll("#form [data-f]")) {
        const f = el.dataset.f;
        const m = meta[f];
        let v;
        let text;
        if (m.type === "many2one") { v = el.dataset.id ? Number(el.dataset.id) : false; text = v ? el.value : ""; }
        else if (m.type === "selection") { v = el.value || false; text = selLabel(meta, f, v); }
        else if (m.type === "boolean") { v = el.value === "true"; text = formatValue(v, m); }
        else { v = parseInput(el.value, m); text = formatValue(v, m); }
        if (m.required && m.type !== "boolean" && (v === false || v === "")) throw new Error(`กรอก "${m.string}" ก่อนบันทึก`);
        const oldText = formatValue(values[f], m);
        const same = NUMERIC.has(m.type) ? v === (values[f] ?? false) : text === oldText;
        if (!id || !same) { vals[f] = v; changes.push(noteChange(f, m.string, id ? oldText : null, text)); }
      }
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      return;
    }
    if (id && !changes.length) return back();
    btn.disabled = true;
    try {
      if (id) {
        await call(model, "write", [[id], vals], {}, { text: `แก้ไข ${values.display_name || `#${id}`} (${changes.length} field)`, changes });
        toast("บันทึกแล้ว");
      } else {
        const newId = await call(model, "create", [vals], {}, { text: `สร้าง ${S.data.label}`, changes });
        toast(`สร้างแล้ว (id ${Array.isArray(newId) ? newId[0] : newId})`);
      }
    } catch (e) {
      btn.disabled = false;
      err.textContent = e.message;
      err.hidden = false;
      return;
    }
    await back();
  },
  async changePassword() {
    const oldPw = $("pw-old").value;
    const newPw = $("pw-new").value;
    const err = $("pw-err");
    const fail = !oldPw || !newPw || !$("pw-confirm").value ? "กรอกให้ครบทั้ง 3 ช่อง"
      : newPw.length < 8 ? "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัว"
      : newPw === oldPw ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม"
      : newPw !== $("pw-confirm").value ? "รหัสผ่านใหม่กับช่องยืนยันไม่ตรงกัน" : "";
    if (fail) { err.textContent = fail; err.hidden = false; return; }
    const { db, username } = S.odoo.info;
    try {
      await call("res.users", "change_password", [oldPw, newPw], {}, { text: `เปลี่ยนรหัสผ่านของ ${username} ใน DB ${db}` });
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      return;
    }
    toast("เปลี่ยนรหัสผ่านแล้ว ถ้า Odoo ให้ล็อกอินใหม่ ใช้รหัสใหม่");
    S.stack = [];
    S.view = { name: "home", params: {} };
    await refresh();
  },
  async exportCsv() {
    const q = S.q;
    let headers;
    let rows;
    if (S.data.grouped) {
      const gm = q.meta[q.group];
      headers = [gm.string, "จำนวน", ...S.data.sums.map(f => q.meta[f].string)];
      rows = S.data.rows.map(r => {
        const key = r[q.group];
        const label = Array.isArray(key) ? key[1] : gm.type === "selection" ? formatValue(key, gm) : key === false ? "" : key;
        return [label, r[`${q.group}_count`] ?? r.__count, ...S.data.sums.map(f => formatValue(r[f], q.meta[f]))];
      });
    } else {
      const kw = { domain: currentDomain(), fields: q.cols, limit: EXPORT_LIMIT };
      if (q.order) kw.order = q.order;
      const all = await call(q.model, "search_read", [], kw, { text: `Export ${q.label} เป็น CSV` });
      headers = q.cols.map(f => q.meta[f]?.string || f);
      rows = all.map(r => q.cols.map(f => formatValue(r[f], q.meta[f])));
    }
    const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${q.model}_${localDateTime(new Date()).slice(0, 10).replace(/\//g, "-")}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Export ${rows.length} แถวแล้ว${rows.length >= EXPORT_LIMIT ? ` (สูงสุด ${EXPORT_LIMIT})` : ""}`);
  },
  copy: d => copyText(d.text, `คัดลอกแล้ว: ${d.text}`),
  copyJson: () => copyText(JSON.stringify(S.data.rec, null, 2), "คัดลอก JSON แล้ว"),
  logFilter(d) { S.logFilter = d.f; paint(); },
  async clearLog() {
    await inPage(S.tab.id, () => window.__odooLens && window.__odooLens.clear());
    toast("ล้าง log แล้ว");
    await refreshLog(true);
  },
  copyLog() {
    const lines = S.log ? S.log.entries.map(describeEntry).map(l =>
      `${l.date} [${KIND_LABEL[l.kind]}] ${l.text}${l.changes ? " | " + l.changes.map(([f, a, b]) => `${f}: ${a != null ? `${a} -> ` : ""}${b}`).join(", ") : ""} (${l.src === "lens" ? "Odoo Lens" : "Odoo"})`) : [];
    return copyText(lines.join("\n"), `คัดลอก log ${lines.length} รายการแล้ว`);
  }
};

const CHANGE = {
  filter(el) {
    const r = S.q.filters[Number(el.dataset.i)];
    r[el.dataset.k] = el.value;
    if (el.dataset.k === "field") {
      const t = S.q.meta[el.value]?.type;
      r.value = "";
      r.op = t === "char" || t === "text" || t === "many2one" ? "ilike" : "=";
    }
    paint();
  },
  group(el) { S.q.group = el.value; },
  cell(el) {
    const id = Number(el.dataset.id);
    const f = el.dataset.f;
    const m = S.q.meta[f];
    const row = S.data.rows.find(r => r.id === id);
    let value;
    try {
      value = m.type === "selection" ? el.value || false : m.type === "boolean" ? el.value === "true" : parseInput(el.value, m);
    } catch (e) {
      toast(`${m.string}: ${e.message}`, true);
      return paint();
    }
    const oldText = formatValue(row[f], m);
    const text = formatValue(value, m);
    const fs = S.q.edits.get(id) || {};
    if (NUMERIC.has(m.type) ? value === row[f] : text === oldText) delete fs[f];
    else fs[f] = { value, text, oldText, input: el.value };
    if (Object.keys(fs).length) S.q.edits.set(id, fs);
    else S.q.edits.delete(id);
    S.confirming = false;
    paint();
  },
  m2oPick(el) {
    const hit = (S.m2oHits[el.dataset.f] || []).find(([, name]) => name === el.value);
    el.dataset.id = hit ? hit[0] : "";
  },
  showPassword(el) {
    for (const id of ["pw-old", "pw-new", "pw-confirm"]) $(id).type = el.checked ? "text" : "password";
  }
};

const searchModels = debounce(async el => {
  const box = $("model-hits");
  const q = el.value.trim();
  if (!box) return;
  if (!q) { box.innerHTML = ""; return; }
  const hits = await call("ir.model", "search_read", [[["transient", "=", false], "|", ["name", "ilike", q], ["model", "ilike", q]], ["name", "model"]], { limit: 8 }).catch(e => { toast(e.message, true); return []; });
  box.innerHTML = hits.length
    ? hits.map(h => `<button type="button" data-act="pickModel" data-model="${esc(h.model)}"><b>${esc(h.name)}</b><span>${esc(h.model)}</span></button>`).join("")
    : `<p class="muted">ไม่พบข้อมูลที่ชื่อ "${esc(q)}"</p>`;
});

const searchM2o = debounce(async el => {
  const hits = await call(el.dataset.rel, "name_search", [], { name: el.value, limit: 8 }).catch(() => []);
  S.m2oHits[el.dataset.f] = hits;
  const list = document.getElementById(`dl-${el.dataset.f}`);
  if (list) list.innerHTML = hits.map(([, name]) => `<option value="${esc(name)}"></option>`).join("");
  CHANGE.m2oPick(el);
});

const INPUT = {
  searchModel: searchModels,
  m2o: searchM2o,
  colFilter: el => { $("col-chips").innerHTML = chipsHtml(el.value); },
  filterRows(el) {
    const t = el.value.toLowerCase();
    for (const row of $(el.dataset.target).children) row.hidden = Boolean(t) && !row.textContent.toLowerCase().includes(t);
  }
};

function run(fn) {
  Promise.resolve().then(fn).catch(e => toast(e.message, true));
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("คัดลอกไม่ได้ ลองอีกครั้ง", true);
  }
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (el && !el.disabled && ACT[el.dataset.act]) run(() => ACT[el.dataset.act](el.dataset, el));
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (el && CHANGE[el.dataset.change]) run(() => CHANGE[el.dataset.change](el));
});
document.addEventListener("input", e => {
  const el = e.target.closest("[data-input]");
  if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el);
});
document.addEventListener("keydown", e => {
  const name = e.target.dataset?.enter;
  if (e.key === "Enter" && name && ACT[name]) run(() => ACT[name](e.target.dataset, e.target));
});
