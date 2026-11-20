const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?[\d,]+(\.\d+)?$/;

/**
 * Build a CSV file Excel opens with Thai text intact (UTF-8 BOM, CRLF).
 * Cells that Excel would run as a formula get a leading apostrophe.
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const cell = raw => {
    const v = FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [headers, ...rows].map(r => r.map(v => cell(String(v ?? ""))).join(",")).join("\r\n");
}
