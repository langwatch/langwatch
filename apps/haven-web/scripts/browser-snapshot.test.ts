import assert from "node:assert/strict";
import { test } from "node:test";

import { filterSnapshot } from "./browser-snapshot.ts";

const text = [
  "- main [ref=e1]:",
  "  - table [ref=e2]:",
  '    - row "alpha" [ref=e3]:',
  '      - cell "x" [ref=e4]',
  '    - row "beta" [ref=e5]',
  '  - button "Save" [ref=e6]',
].join("\n");

void test("no filters leaves the snapshot alone", () => {
  assert.equal(filterSnapshot({ text }), text);
});

void test("--grep keeps matches and their ancestors only", () => {
  assert.equal(
    filterSnapshot({ text, grep: "BETA" }),
    ["- main [ref=e1]:", "  - table [ref=e2]:", '    - row "beta" [ref=e5]'].join("\n"),
  );
});

void test("--depth drops deeper nodes", () => {
  assert.equal(filterSnapshot({ text, depth: 2 }).split("\n").length, 3);
});

void test("--max-chars cuts at a line and says how to narrow", () => {
  const out = filterSnapshot({ text, maxChars: 40 });
  assert.match(out, /truncated at 40 chars/);
  assert.match(out, /narrow with --grep/);
  assert.equal(out.split("\n")[0], "- main [ref=e1]:");
});
