// Mocks the Chrome extension APIs, then boots the real popup against the fake Odoo backend.
const store = {};
window.chrome = {
  tabs: {
    query: async () => [{ id: 1, url: new URLSearchParams(location.search).get("url") || "http://localhost:8069/odoo/sales/42" }],
    create: async ({ url }) => { window.__opened = url; }
  },
  scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] },
  storage: {
    local: {
      get: async key => ({ [key]: store[key] }),
      set: async obj => { Object.assign(store, obj); }
    }
  }
};

window.pageCall = (model, method, args) => {
  const x = new XMLHttpRequest();
  x.open("POST", "/web/dataset/call_button");
  x.send(JSON.stringify({ jsonrpc: "2.0", method: "call", params: { model, method, args, kwargs: {} } }));
};

const html = await (await fetch("../../src/popup/popup.html")).text();
const doc = new DOMParser().parseFromString(html, "text/html");
document.body.innerHTML = doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "");
await import("../../src/popup/popup.js");
