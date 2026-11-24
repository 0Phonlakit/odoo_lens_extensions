# Odoo Lens

A small Chrome extension for browsing, editing and tracing Odoo data from a popup.
It uses your existing Odoo login and the Odoo ORM (JSON-RPC), so Odoo's access rights,
record rules, computed fields, constraints and chatter all keep working. Nothing is
installed on the Odoo server.

Supported: Odoo 16, 17 and 18 backends (`/web#...` and `/odoo/...` URLs).

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Reload any Odoo tab that was already open, so the page log starts recording.
4. Open an Odoo page and click the Odoo Lens icon in the toolbar.

To share with the team, zip this folder (without `tests/`) and have each person load it the same way,
or publish it unlisted on the Chrome Web Store.

## What it does

| Area | What you get |
|---|---|
| DB bar | Current database, environment tag (Production / Staging / Local, guessed from the DB and host name), host and login |
| Current page | Detects the record you are on, shows every field (label, technical name, type, value) |
| Linked documents | For any document with lines (sale/purchase orders, invoices, transfers, manufacturing orders, custom models): every other document whose lines link to its lines, the field pair that links them (e.g. `sale.order.line.invoice_lines` ↔ `account.move.line.sale_line_ids`), the join table, which lines are paired, and a domain to find those documents. Paths come from Odoo's own `ir.model.fields`, so nothing is hard-coded per module. Every relational field of the record is listed too |
| Query builder | Pick a model, columns, filters and an optional group-by with sums; save queries per database |
| Dev mode | Type a Python-style domain and field list, run `search_read` |
| CRUD | Create, view, edit (form or inline cells) and delete, each through `create` / `read` / `write` / `unlink`. Edits and deletes ask for confirmation first; Odoo's own errors are shown as-is |
| Export | CSV with a UTF-8 BOM (opens in Excel with Thai text), up to 2,000 rows |
| Change password | Changes the current user's password on the current database via `res.users.change_password` |
| Page log | Every model call made on the page, by Odoo itself or by Odoo Lens, in plain Thai with old → new values; filter by change / read / error, copy or clear. A full page reload wipes it |

## Low memory by design

- **Popup only, no background service worker.** Chrome frees the popup when it closes, so the extension uses no memory while you are not looking at it.
- **No framework, no bundler.** Plain ES modules, about 90 KB in total.
- **Page log lives in the page.** `src/page/hook.js` keeps at most 200 short entries (values cut to 200 characters) in the tab's own memory, so a reload clears it and nothing is stored on disk. It runs only on `/web*` and `/odoo*` URLs.
- **Small reads.** Tables load 80 rows per page; the log polls every 2 seconds only while the Log tab is open.
- **Password safety.** Calls to methods or fields named like `password`, `secret`, `token` or `api_key` are masked in the log; Odoo Lens never stores a password.

## How it talks to Odoo

`src/popup/odoo.js` runs each call inside the Odoo tab with `chrome.scripting.executeScript` (`world: "MAIN"`),
so the request goes out from the Odoo page with your session cookie, exactly like a click in Odoo.
Calls made by Odoo Lens carry an `X-Odoo-Lens` header: user actions carry a short note for the log,
background reads (field lists, table loads) carry `-` and are left out of the log.

## Develop

```bash
npm test
```

Runs the unit tests (`node --test`, no dependencies).

The browser harness runs the real popup and page hook against a fake Odoo backend with mocked Chrome APIs:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8765/tests/harness/index.html>
(add `?url=http://localhost:8069/web%23id%3D42%26model%3Dsale.order` to try the Odoo 16 URL style).

## Limits

- Inline cell editing covers text, number, date, selection and boolean fields; many-to-one fields are edited in the form.
- Calls use the user's default company context; switching companies in Odoo's company switcher is not passed through.
- Linked documents follow links between lines (up to 200 lines per list). A target counts as a document when its model has a `state` field; links made only at header level (e.g. `stock.picking.sale_id`) show in the relational field list of the record that holds the field, not as a reverse link.
- Finding line links reads `ir.model.fields`, which internal users can read in standard Odoo; if a database restricts it, the view says so and still lists the record's relational fields.
