import { describe, expect, it } from "vitest";

import {
  compilePolicyPiiExceptions,
  compilePolicySecretPatterns,
  isIdentifierAttributeName,
  nativePiiEntitiesForPolicy,
  needsStrictAnalysis,
  redactAttributeNative,
  type RedactionPolicy,
  redactStringNative,
} from "../contentRedaction.js";
import { SECRETS_REDACTION_MARKER } from "../secrets.js";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * The composition of the two native passes for one resolved policy. Its
 * decisions are the ones a customer's privacy settings actually buy: which
 * level runs which recognizers, whether secrets run alongside, and which
 * attribute names are exempt from which rules.
 */

const policy = (over: Partial<RedactionPolicy> = {}): RedactionPolicy => ({
  pii: { level: "essential", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  ...over,
});

/** A key-shaped token, assembled at run time so no literal credential exists here. */
const SHAPED_TOKEN = `acme_${"aB3dEf7gHi2jKlMnOpQrStUv"}`;

describe("given a resolved policy naming a PII level", () => {
  it("runs every native recognizer at the essential level", () => {
    expect(nativePiiEntitiesForPolicy(policy())).toBe("all");
  });

  it("runs every native recognizer at the strict level too, as the floor under it", () => {
    const strict = policy({ pii: { level: "strict", entities: [], exceptPatterns: [] } });
    expect(nativePiiEntitiesForPolicy(strict)).toBe("all");
  });

  it("runs none when PII is disabled", () => {
    const off = policy({ pii: { level: "disabled", entities: [], exceptPatterns: [] } });
    expect(nativePiiEntitiesForPolicy(off)).toBeNull();
  });

  /** @scenario "A custom level sends only the identifiers it selected and the native engine cannot detect" */
  it("runs only the native part of a custom selection", () => {
    const custom = policy({
      pii: { level: "custom", entities: ["EMAIL_ADDRESS", "PERSON"], exceptPatterns: [] },
    });
    expect(nativePiiEntitiesForPolicy(custom)).toEqual(["EMAIL_ADDRESS"]);
  });

  it("needs the analysis service only for the strict level", () => {
    expect(needsStrictAnalysis(policy())).toBe(false);
    expect(
      needsStrictAnalysis(policy({ pii: { level: "strict", entities: [], exceptPatterns: [] } })),
    ).toBe(true);
  });
});

describe("given both native passes on one string", () => {
  it("scrubs the credential and the personal data, and keeps neither original", () => {
    const result = redactStringNative({
      text: `token ${SHAPED_TOKEN} for ana@example.com`,
      policy: policy(),
    });

    expect(result.text).toContain(SECRETS_REDACTION_MARKER);
    expect(result.text).toContain("[EMAIL_ADDRESS]");
    expect(result.text).not.toContain(SHAPED_TOKEN);
    expect(result.text).not.toContain("ana@example.com");
  });

  it("still scrubs credentials when PII is disabled, because they are separate concerns", () => {
    const off = policy({ pii: { level: "disabled", entities: [], exceptPatterns: [] } });
    const result = redactStringNative({ text: `token ${SHAPED_TOKEN}`, policy: off });

    expect(result.text).toContain(SECRETS_REDACTION_MARKER);
  });

  it("leaves the credential alone when secrets redaction is off", () => {
    const off = policy({ secrets: { enabled: false, customPatterns: [] } });
    const result = redactStringNative({ text: `token ${SHAPED_TOKEN}`, policy: off });

    expect(result.text).toContain(SHAPED_TOKEN);
  });

  it("applies the policy's own custom secret patterns", () => {
    const withCustom = policy({
      secrets: { enabled: true, customPatterns: ["INTERNAL-[0-9]{4}"] },
    });
    const result = redactStringNative({
      text: "ref INTERNAL-4821",
      policy: withCustom,
      compiledSecretPatterns: compilePolicySecretPatterns(withCustom),
    });

    expect(result.text).toBe(`ref ${SECRETS_REDACTION_MARKER}`);
  });
});

describe("given an attribute whose NAME says the value is sensitive", () => {
  /** @scenario "A credential named by its attribute is scrubbed whatever it looks like" */
  it("replaces the whole value regardless of its shape", () => {
    const result = redactAttributeNative({
      key: "http.request.header.authorization",
      value: "plain-looking-value",
      policy: policy(),
    });

    expect(result.text).toBe(SECRETS_REDACTION_MARKER);
    expect(result.redactedCount).toBe(1);
  });

  /** @scenario "A credential named by its attribute is scrubbed whatever it looks like" */
  it("leaves it alone when secrets redaction is off", () => {
    const off = policy({ secrets: { enabled: false, customPatterns: [] } });
    const result = redactAttributeNative({
      key: "http.request.header.authorization",
      value: "plain-looking-value",
      policy: off,
    });

    expect(result.text).toBe("plain-looking-value");
  });
});

describe("given an attribute whose NAME says the value is an identifier", () => {
  it("recognises the three spellings the pipeline uses, and nothing wider", () => {
    expect(isIdentifierAttributeName("id")).toBe(true);
    expect(isIdentifierAttributeName("scenario.run_id")).toBe(true);
    expect(isIdentifierAttributeName("langwatch.prompt.id")).toBe(true);
    expect(isIdentifierAttributeName("langwatch.input")).toBe(false);
    expect(isIdentifierAttributeName("identity")).toBe(false);
  });

  /** @scenario "A record identifier stays addressable" */
  it("keeps a record id readable instead of writing a marker over it", () => {
    const result = redactAttributeNative({
      key: "scenario.run_id",
      value: SHAPED_TOKEN,
      policy: policy(),
    });

    expect(result.text).toBe(SHAPED_TOKEN);
  });

  /** @scenario "A record identifier stays addressable" */
  it("still scrubs a real vendor credential parked under an identifier name", () => {
    const vendorKey = `sk-ant-api03-${"aB3dEf7gHi2jKlMnOpQrStUvWx0123456789xYzAbCdEfGh"}`;
    const result = redactAttributeNative({
      key: "scenario.run_id",
      value: vendorKey,
      policy: policy(),
    });

    expect(result.text).not.toContain(vendorKey);
  });

  /** @scenario "A record identifier stays addressable" */
  it("still runs the whole personal-data pass on it", () => {
    const result = redactAttributeNative({
      key: "metadata.user_id",
      value: "ana@example.com",
      policy: policy(),
    });

    expect(result.text).toBe("[EMAIL_ADDRESS]");
  });

  /** @scenario "A record identifier stays addressable" */
  it("exempts the same value from the deny-list when the name is an identifier of a credential", () => {
    const result = redactAttributeNative({
      key: "api_key.id",
      value: "plain-looking-value",
      policy: policy(),
    });

    expect(result.text).toBe("plain-looking-value");
  });
});

describe("given a policy carrying do-not-redact exceptions", () => {
  /** @scenario "A do-not-redact exception preserves its whole matched text" */
  it("compiles them anchored, so only a whole matched text is vetoed", () => {
    const withExceptions = policy({
      pii: { level: "essential", entities: [], exceptPatterns: ["ops@example\\.com"] },
    });
    const compiled = compilePolicyPiiExceptions(withExceptions);
    const result = redactAttributeNative({
      key: "langwatch.input",
      value: "ops@example.com",
      policy: withExceptions,
      compiledPiiExceptions: compiled,
    });

    expect(result.text).toBe("ops@example.com");
  });
});
