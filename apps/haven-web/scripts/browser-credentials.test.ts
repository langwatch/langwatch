import assert from "node:assert/strict";
import { test } from "node:test";

import { chromium } from "playwright";

import {
  CREDENTIAL_AUTOCOMPLETE,
  credentialValuesOnPage,
  redactCredentials,
} from "./browser-credentials.ts";
import { diffSnapshots } from "./browser-observe.ts";

/** What Playwright's ai-mode snapshot printed for a sign-in form: password values in clear. */
const snapshot = [
  "- generic [active] [ref=e1]:",
  '  - textbox "Email" [ref=e3]: a@b.c',
  '  - textbox "Password" [ref=e5]: hunter2-secret',
  "  - textbox [ref=e7]: pw1",
  '  - textbox "Code" [ref=e8]: "123456"',
  "  - paragraph [ref=e9]: Welcome back, your password is hunter2-secret",
].join("\n");

const values = ["hunter2-secret", "pw1", "123456"];

/** @scenario "The browser never prints what a credential field holds" */
void test("a credential field's value reads *** in a snapshot, whatever its length", () => {
  const out = redactCredentials({ text: snapshot, values });
  assert.match(out, /textbox "Password" \[ref=e5\]: \*\*\*$/m);
  assert.match(out, /textbox \[ref=e7\]: \*\*\*$/m);
  assert.match(out, /textbox "Code" \[ref=e8\]: \*\*\*$/m);
  assert.match(out, /textbox "Email" \[ref=e3\]: a@b\.c$/m);
  for (const value of values) assert.equal(out.includes(value), false, value);
});

/** @scenario "The browser never prints what a credential field holds" */
void test("a long credential value is hidden outside its field too", () => {
  const out = redactCredentials({ text: snapshot, values });
  assert.match(out, /your password is \*\*\*$/m);
});

/** @scenario "The browser never prints what a credential field holds" */
void test("a short value is hidden only where a field shows it", () => {
  assert.equal(redactCredentials({ text: "step pw1 of 3", values: ["pw1"] }), "step pw1 of 3");
});

/** @scenario "The browser never prints what a credential field holds" */
void test("the diff an action prints carries no credential value", () => {
  const before = '- textbox "Password" [ref=e5]';
  const after = redactCredentials({ text: '- textbox "Password" [ref=e5]: pw1', values: ["pw1"] });
  assert.equal(JSON.stringify(diffSnapshots({ before, after })).includes("pw1"), false);
});

/** @scenario "The browser never prints what a credential field holds" */
void test("the page reports its password and credential-autocomplete values only", async (t) => {
  const browser = await chromium.launch().catch(() => null);
  if (!browser) return t.skip("no Chromium on this machine");
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label>Email <input type=email value="a@b.c"></label>
      <label>Password <input type=password value="hunter2-secret"></label>
      <input autocomplete="one-time-code" aria-label="Code" value="123456">
      <input autocomplete="section-a new-password" aria-label="Shown" value="visible-pw">
      <input type=password value="">`);
    const found = await page.evaluate(credentialValuesOnPage, CREDENTIAL_AUTOCOMPLETE);
    assert.deepEqual(found, ["hunter2-secret", "123456", "visible-pw"]);
    const out = redactCredentials({
      text: await page.ariaSnapshot({ mode: "ai" }),
      values: found,
    });
    for (const value of found) assert.equal(out.includes(value), false, value);
    assert.match(out, /a@b\.c/);
  } finally {
    await browser.close();
  }
});
