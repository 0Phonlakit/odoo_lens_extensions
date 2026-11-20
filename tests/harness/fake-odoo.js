// Fake Odoo JSON-RPC backend for the browser harness. Loaded before src/page/hook.js so the hook wraps it.
(() => {
  const FIELDS = {
    "sale.order": {
      name: { string: "Order Reference", type: "char", store: true, required: true },
      partner_id: { string: "Customer", type: "many2one", relation: "res.partner", store: true, required: true },
      date_order: { string: "Order Date", type: "datetime", store: true },
      state: { string: "Status", type: "selection", store: true, readonly: true,
        selection: [["draft", "Quotation"], ["sent", "Quotation Sent"], ["sale", "Sales Order"], ["cancel", "Cancelled"]] },
      amount_total: { string: "Total", type: "monetary", store: true, readonly: true },
      user_id: { string: "Salesperson", type: "many2one", relation: "res.users", store: true },
      client_order_ref: { string: "Customer Reference", type: "char", store: true },
      order_line: { string: "Order Lines", type: "one2many", relation: "sale.order.line", store: true },
      invoice_ids: { string: "Invoices", type: "many2many", relation: "account.move", store: false, readonly: true },
      display_name: { string: "Display Name", type: "char", store: false, readonly: true }
    },
    "account.move": {
      name: { string: "Number", type: "char", store: true },
      state: { string: "Status", type: "selection", store: true, selection: [["draft", "Draft"], ["posted", "Posted"], ["cancel", "Cancelled"]] },
      amount_total: { string: "Total", type: "monetary", store: true },
      move_type: { string: "Type", type: "selection", store: true, selection: [["out_invoice", "Customer Invoice"], ["out_refund", "Customer Credit Note"]] },
      invoice_origin: { string: "Origin", type: "char", store: true },
      invoice_line_ids: { string: "Invoice lines", type: "one2many", relation: "account.move.line", store: true },
      display_name: { string: "Display Name", type: "char", store: false }
    },
    "stock.picking": {
      name: { string: "Reference", type: "char", store: true },
      state: { string: "Status", type: "selection", store: true, selection: [["assigned", "Ready"], ["done", "Done"]] },
      origin: { string: "Source Document", type: "char", store: true },
      display_name: { string: "Display Name", type: "char", store: false }
    },
    "res.partner": {
      name: { string: "Name", type: "char", store: true, required: true },
      email: { string: "Email", type: "char", store: true },
      display_name: { string: "Display Name", type: "char", store: false }
    }
  };

  const P = { 7: "Siam Supplies Co.", 8: "Chiang Mai Construction", 9: "Isan Steel" };
  const U = { 2: "Somchai Jaidee", 3: "Wipa Suksan" };
  const DB = {
    "sale.order": [
      { id: 42, name: "SO0042", partner_id: 7, date_order: "2026-11-12 03:00:00", state: "sale", amount_total: 29767.4, user_id: 2, client_order_ref: "PO-7781", order_line: [101, 102, 103] },
      { id: 41, name: "SO0041", partner_id: 8, date_order: "2026-11-11 04:30:00", state: "sale", amount_total: 15840, user_id: 3, client_order_ref: false, order_line: [] },
      { id: 40, name: "SO0040", partner_id: 7, date_order: "2026-11-10 02:00:00", state: "draft", amount_total: 8250, user_id: 2, client_order_ref: false, order_line: [] },
      { id: 39, name: "SO0039", partner_id: 9, date_order: "2026-11-08 08:15:00", state: "sale", amount_total: 112300, user_id: 3, client_order_ref: "ISN-12", order_line: [] }
    ],
    "sale.order.line": [
      { id: 101, name: "PVC pipe 4in", product_id: [1, "PVC pipe 4in"], invoice_lines: [5501], order_id: 42 },
      { id: 102, name: "Tee joint 4in", product_id: [2, "Tee joint 4in"], invoice_lines: [5502], order_id: 42 },
      { id: 103, name: "Pipe glue 1kg", product_id: [3, "Pipe glue 1kg"], invoice_lines: [5630], order_id: 42 }
    ],
    "account.move.line": [
      { id: 5501, name: "PVC pipe 4in", product_id: [1, "PVC pipe 4in"], move_id: 118, sale_line_ids: [101] },
      { id: 5502, name: "Tee joint 4in", product_id: [2, "Tee joint 4in"], move_id: 118, sale_line_ids: [102] },
      { id: 5630, name: "Pipe glue 1kg", product_id: [3, "Pipe glue 1kg"], move_id: 131, sale_line_ids: [103] }
    ],
    "account.move": [
      { id: 118, name: "INV/2026/00118", state: "posted", amount_total: 26450.4, move_type: "out_invoice", invoice_origin: "SO0042", invoice_line_ids: [5501, 5502] },
      { id: 131, name: "INV/2026/00131", state: "draft", amount_total: 3317, move_type: "out_invoice", invoice_origin: "SO0042", invoice_line_ids: [5630] }
    ],
    "stock.move": [
      { id: 9120, picking_id: 87, sale_line_id: 101 },
      { id: 9121, picking_id: 87, sale_line_id: 102 },
      { id: 9122, picking_id: 87, sale_line_id: 103 }
    ],
    "stock.picking": [{ id: 87, name: "WH/OUT/00087", state: "done", origin: "SO0042" }],
    "ir.model": [
      { id: 1, name: "Sales Order", model: "sale.order", transient: false },
      { id: 2, name: "Journal Entry", model: "account.move", transient: false },
      { id: 3, name: "Transfer", model: "stock.picking", transient: false },
      { id: 4, name: "Contact", model: "res.partner", transient: false }
    ],
    "ir.actions.act_window": [{ id: 300, path: "sales", res_model: "sale.order" }],
    "res.partner": Object.entries(P).map(([id, name]) => ({ id: Number(id), name, email: false })),
    "res.users": Object.entries(U).map(([id, name]) => ({ id: Number(id), name }))
  };
  let nextId = 1000;

  const NAMES = { "res.partner": P, "res.users": U, "sale.order": null, "account.move": null, "stock.picking": null };
  const M2O = { partner_id: "res.partner", user_id: "res.users", move_id: "account.move", picking_id: "stock.picking", sale_line_id: "sale.order.line", order_id: "sale.order" };

  function nameOf(model, id) {
    const rec = (DB[model] || []).find(r => r.id === id);
    return rec ? rec.name : `#${id}`;
  }

  function out(model, rec, fields) {
    const r = { id: rec.id };
    for (const f of fields || Object.keys(rec)) {
      if (f === "display_name") r[f] = rec.name;
      else if (M2O[f] && Number.isInteger(rec[f])) r[f] = [rec[f], nameOf(M2O[f], rec[f])];
      else r[f] = rec[f] ?? false;
    }
    return r;
  }

  function leaf(rec, [f, op, v]) {
    let x = rec[f];
    if (Array.isArray(x) && !Array.isArray(v)) x = x[0];
    switch (op) {
      case "=": return x === v || (v === false && !x);
      case "!=": return x !== v;
      case "in": return v.includes(x) || (Array.isArray(rec[f]) && rec[f].some(y => v.includes(y)));
      case "ilike": return String(M2O[f] ? nameOf(M2O[f], x) : x ?? "").toLowerCase().includes(String(v).toLowerCase());
      case ">=": return x >= v;
      case "<=": return x <= v;
      default: return true;
    }
  }

  function match(rec, domain) {
    let i = 0;
    const next = () => {
      const t = domain[i++];
      if (t === "|") { const a = next(); const b = next(); return a || b; }
      if (t === "&") { const a = next(); const b = next(); return a && b; }
      return leaf(rec, t);
    };
    let ok = true;
    while (i < domain.length) ok = next() && ok;
    return ok;
  }

  function err(message) {
    return { error: { code: 200, message: "Odoo Server Error", data: { message } } };
  }

  function callKw({ model, method, args, kwargs }) {
    const rows = DB[model] || [];
    switch (method) {
      case "fields_get": return { result: FIELDS[model] || {} };
      case "check_access_rights": return { result: true };
      case "search_read": {
        const domain = kwargs.domain ?? args[0] ?? [];
        const fields = kwargs.fields ?? args[1];
        let found = rows.filter(r => match(r, domain));
        if (kwargs.order) {
          const [f, dir] = kwargs.order.split(" ");
          found = [...found].sort((a, b) => (a[f] > b[f] ? 1 : -1) * (dir === "desc" ? -1 : 1));
        }
        const off = kwargs.offset || 0;
        return { result: found.slice(off, off + (kwargs.limit || 80)).map(r => out(model, r, fields)) };
      }
      case "search_count": return { result: rows.filter(r => match(r, args[0] || [])).length };
      case "read": return { result: args[0].map(id => rows.find(r => r.id === id)).filter(Boolean).map(r => out(model, r, args[1])) };
      case "read_group": {
        const g = kwargs.groupby[0];
        const groups = new Map();
        for (const r of rows.filter(x => match(x, kwargs.domain || []))) {
          const key = r[g];
          if (!groups.has(key)) groups.set(key, { [g]: M2O[g] ? [key, nameOf(M2O[g], key)] : key, [`${g}_count`]: 0 });
          const row = groups.get(key);
          row[`${g}_count`]++;
          for (const spec of kwargs.fields || []) {
            const f = spec.split(":")[0];
            row[f] = (row[f] || 0) + (r[f] || 0);
          }
        }
        return { result: [...groups.values()] };
      }
      case "write": {
        for (const id of args[0]) Object.assign(rows.find(r => r.id === id), args[1]);
        return { result: true };
      }
      case "create": {
        const id = nextId++;
        rows.unshift({ id, name: args[0].name || `NEW${id}`, state: "draft", amount_total: 0, order_line: [], ...args[0] });
        return { result: id };
      }
      case "unlink": {
        const bad = rows.find(r => args[0].includes(r.id) && r.state === "sale");
        if (bad) return err("You can not delete a sent quotation or a confirmed sales order. You must first cancel it.");
        DB[model] = rows.filter(r => !args[0].includes(r.id));
        return { result: true };
      }
      case "default_get": return { result: { user_id: 2, date_order: "2026-11-21 02:00:00" } };
      case "name_search": {
        const q = (kwargs.name || "").toLowerCase();
        return { result: Object.entries(NAMES[model] || {}).filter(([, n]) => n.toLowerCase().includes(q)).map(([id, n]) => [Number(id), n]) };
      }
      case "change_password": return args[0] === "old-pass-123" ? { result: true } : err("The old password you provided is incorrect, your password was not changed.");
      case "action_confirm": return { result: true };
      case "action_cancel": return err("You cannot cancel an order with done deliveries.");
      default: return err(`Fake backend has no ${model}.${method}`);
    }
  }

  function route(url, body) {
    const params = JSON.parse(body || "{}").params || {};
    const reply = url.includes("/web/session/get_session_info")
      ? { result: { uid: 2, db: "kaw_prod", username: "somchai@example.com", user_context: { lang: "th_TH", tz: "Asia/Bangkok", uid: 2 } } }
      : callKw(params);
    return JSON.stringify({ jsonrpc: "2.0", id: 1, ...reply });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    if (!String(url).includes("/web/")) return realFetch(url, init);
    const text = route(String(url), init.body);
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };

  window.XMLHttpRequest = class {
    open(method, url) { this.url = url; }
    setRequestHeader() {}
    addEventListener(name, fn) { (this.listeners ||= {})[name] = fn; }
    send(body) {
      setTimeout(() => {
        this.status = 200;
        this.responseType = "";
        this.responseText = route(this.url, body);
        this.listeners?.loadend?.();
      }, 30);
    }
  };
})();
