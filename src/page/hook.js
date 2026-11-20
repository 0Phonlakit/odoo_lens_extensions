// Runs in the Odoo page (MAIN world). Records the page's model calls in memory so a full reload clears them.
(() => {
  if (window.__odooLens) return;

  const MAX_ENTRIES = 200;
  const MAX_TEXT = 200;
  const MAX_KEYS = 15;
  const RPC_URL = /\/web\/dataset\/call_(kw|button)/;
  const SECRET = /pass(wd|word)?|secret|token|api_?key|otp/i;
  const LENS_HEADER = "X-Odoo-Lens";
  const LENS_INTERNAL = "-";
  const startedAt = Date.now();
  const log = [];

  function cut(s) {
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
  }

  function safeVals(vals) {
    const out = {};
    for (const [k, v] of Object.entries(vals).slice(0, MAX_KEYS)) {
      out[k] = SECRET.test(k) ? "••••"
        : typeof v === "string" ? cut(v)
        : v !== null && typeof v === "object" ? cut(JSON.stringify(v)) : v;
    }
    return out;
  }

  function entryFor(url, body, noteRaw) {
    if (noteRaw === LENS_INTERNAL || !RPC_URL.test(url) || typeof body !== "string") return null;
    let p;
    try { p = JSON.parse(body).params || {}; } catch { return null; }
    if (!p.model || !p.method) return null;
    const args = Array.isArray(p.args) ? p.args : [];
    const secret = SECRET.test(p.method);
    const first = args[0];
    const ids = Array.isArray(first) && first.length && first.every(Number.isInteger) ? first.slice(0, 20)
      : Number.isInteger(first) ? [first] : null;
    let vals = null;
    if (!secret) {
      if (p.method === "write" || p.method === "web_save") vals = args[1];
      else if (p.method === "create") vals = Array.isArray(first) ? first[0] : first;
    }
    let note = null;
    if (noteRaw) { try { note = JSON.parse(decodeURIComponent(noteRaw)); } catch { note = null; } }
    return {
      t: Date.now(),
      model: p.model,
      method: p.method,
      ids,
      vals: vals && typeof vals === "object" ? safeVals(vals) : null,
      preview: secret ? "••••" : cut((JSON.stringify(args, (k, v) => (SECRET.test(k) ? "••••" : v)) ?? "[]").slice(1, -1)),
      ms: 0,
      err: null,
      src: noteRaw ? "lens" : "odoo",
      note,
      noteRaw: noteRaw || null
    };
  }

  function push(e) {
    log.push(e);
    if (log.length > MAX_ENTRIES) log.shift();
  }

  function errorIn(text) {
    if (!text || !text.slice(0, MAX_TEXT).includes('"error"')) return null;
    try {
      const err = JSON.parse(text).error;
      return err ? (err.data && err.data.message) || err.message || "error" : null;
    } catch { return null; }
  }

  const X = window.XMLHttpRequest.prototype;
  const open = X.open;
  const send = X.send;
  const setHeader = X.setRequestHeader;
  X.open = function (method, url, ...rest) {
    this.__lensUrl = String(url);
    return open.call(this, method, url, ...rest);
  };
  X.setRequestHeader = function (name, value) {
    if (name === LENS_HEADER) this.__lensNote = value;
    return setHeader.call(this, name, value);
  };
  X.send = function (body) {
    const e = this.__lensUrl ? entryFor(this.__lensUrl, body, this.__lensNote) : null;
    if (e) {
      const t0 = performance.now();
      this.addEventListener("loadend", () => {
        e.ms = Math.round(performance.now() - t0);
        if (this.status >= 400) e.err = `HTTP ${this.status}`;
        else if (this.responseType === "json") e.err = this.response && this.response.error ? this.response.error.data?.message || this.response.error.message : null;
        else if (this.responseType === "" || this.responseType === "text") e.err = errorIn(this.responseText);
        push(e);
      });
    }
    return send.call(this, body);
  };

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const headers = init && init.headers;
    const noteRaw = headers ? (typeof headers.get === "function" ? headers.get(LENS_HEADER) : headers[LENS_HEADER]) : null;
    const e = url && init ? entryFor(url, init.body, noteRaw) : null;
    if (!e) return nativeFetch.apply(this, arguments);
    const t0 = performance.now();
    return nativeFetch.apply(this, arguments).then(res => {
      e.ms = Math.round(performance.now() - t0);
      if (!res.ok) e.err = `HTTP ${res.status}`;
      push(e);
      return res;
    }, err => {
      e.err = String(err && err.message || err);
      push(e);
      throw err;
    });
  };

  window.__odooLens = {
    startedAt,
    entries: () => log.map(({ noteRaw, ...e }) => e),
    clear: () => { log.length = 0; },
    fail(noteRaw, message) {
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].noteRaw === noteRaw) { log[i].err = message; return; }
      }
    }
  };
})();
