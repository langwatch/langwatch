import assert from "node:assert/strict";
import { test } from "node:test";

import { stampLines } from "./browser-log.ts";

void test("every whole line gets the stamp", () => {
  const out = stampLines({ text: "a\nb\n", stamp: "T", atLineStart: true });
  assert.equal(out.text, "T a\nT b\n");
  assert.equal(out.atLineStart, true);
});

void test("a line split across writes is stamped once", () => {
  const first = stampLines({ text: "lane x ", stamp: "T1", atLineStart: true });
  const second = stampLines({ text: "closed\nnext", stamp: "T2", atLineStart: first.atLineStart });
  assert.equal(first.text + second.text, "T1 lane x closed\nT2 next");
  assert.equal(second.atLineStart, false);
});
