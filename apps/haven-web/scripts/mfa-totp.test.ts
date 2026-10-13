import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTotp, redactSecrets, totpCode, wrongCode } from "./mfa-totp.ts";

// RFC 6238 appendix B: the ASCII key "12345678901234567890", SHA1, T = 59 s.
const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

/** @scenario "TOTP enroll reads the secret off the page and keeps it from the caller" */
void test("a bare key and an otpauth URI parse to the same TOTP", () => {
  const bare = parseTotp({ raw: "gezd gnbv gy3t qojq gezd gnbv gy3t qojq" });
  const uri = parseTotp({ raw: `otpauth://totp/LangWatch:sam?secret=${RFC}&issuer=LangWatch` });
  assert.deepEqual(bare, { secret: RFC, algorithm: "SHA1", digits: 6, period: 30 });
  assert.deepEqual(uri, bare);
  assert.equal(parseTotp({ raw: "123456" }), undefined);
});

/** @scenario "TOTP fill types the current code, or a wrong one, without printing it" */
void test("codes match the RFC 6238 vectors", () => {
  const totp = { secret: RFC, algorithm: "SHA1", digits: 8, period: 30 };
  assert.equal(totpCode({ totp, now: 59_000 }), "94287082");
  assert.equal(totpCode({ totp, now: 1_111_111_109_000 }), "07081804");
});

/** @scenario "TOTP fill types the current code, or a wrong one, without printing it" */
void test("a wrong code is well formed and accepted in no nearby window", () => {
  const totp = { secret: RFC, algorithm: "SHA1", digits: 6, period: 30 };
  const now = 1_111_111_109_000;
  const wrong = wrongCode({ totp, now });
  assert.match(wrong, /^\d{6}$/);
  for (const steps of [-1, 0, 1]) assert.notEqual(wrong, totpCode({ totp, now, steps }));
});

/** @scenario "TOTP enroll reads the secret off the page and keeps it from the caller" */
void test("redaction hides the key raw, grouped and inside an otpauth URI", () => {
  const text = `textbox: ${RFC}\ntext: GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ\nlink otpauth://totp/x?secret=${RFC}`;
  const out = redactSecrets({ text, secrets: [RFC] });
  assert.ok(!out.includes("GEZD"));
  assert.match(out, /otpauth:\/\/\*\*\*/);
});
