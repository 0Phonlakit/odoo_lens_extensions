import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/lib/csv.js";

test("writes a BOM, a header row and CRLF lines so Excel shows Thai text", () => {
  assert.equal(toCsv(["เลขที่", "ยอด"], [["SO1", "10.00"], ["SO2", "5.00"]]),
    "﻿เลขที่,ยอด\r\nSO1,10.00\r\nSO2,5.00");
});

test("neutralises cells Excel would run as formulas but keeps negative numbers", () => {
  assert.equal(toCsv(["a"], [["=HYPERLINK(\"x\")"], ["+cmd"], ["@sum"], ["-1,234.50"], ["-5"]]),
    '﻿a\r\n"\'=HYPERLINK(""x"")"\r\n\'+cmd\r\n\'@sum\r\n"-1,234.50"\r\n-5');
});

test("quotes cells that hold commas, quotes or new lines", () => {
  assert.equal(toCsv(["a"], [['say "hi"'], ["1,234.00"], ["two\nlines"]]),
    '﻿a\r\n"say ""hi"""\r\n"1,234.00"\r\n"two\nlines"');
});
