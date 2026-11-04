/**
 * The docs origins a deployment registers (ADR-185).
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import { describe, expect, it } from "vitest";

import { parseProcessConfig } from "../config.ts";
import {
  docsOrigins,
  isRegisteredDocsOrigin,
  registeredDocsOrigins,
  SAAS_DOCS_ORIGIN,
} from "../docs-origins.ts";

const owner = { name: "docs", config: { docsOrigins } } as const;

function parse(value: string | undefined) {
  return parseProcessConfig({
    owners: [owner],
    environment: value === undefined ? {} : { LANGWATCH_DOCS_ORIGINS: value },
  }).docs.docsOrigins;
}

describe("LANGWATCH_DOCS_ORIGINS", () => {
  it("reads exact origins separated by commas or spaces", () => {
    expect(parse("https://docs.example.com, http://localhost:3000")).toEqual([
      "https://docs.example.com",
      "http://localhost:3000",
    ]);
  });

  it("reads unset and blank as none named", () => {
    expect(parse(undefined)).toBeUndefined();
    expect(parse("  ")).toBeUndefined();
  });

  it.each(["https://*.example.com", "https://example.com/docs", "example.com", "*"])(
    "refuses %s rather than widening the list",
    (value) => {
      expect(() => parse(value)).toThrow(/not an exact origin/);
    },
  );
});

describe("registeredDocsOrigins", () => {
  it("registers Cloud's site on a hosted deployment that names none", () => {
    expect(
      registeredDocsOrigins({
        configured: undefined,
        isSaas: true,
        publicBaseUrl: "https://app.langwatch.ai",
      }),
    ).toEqual([SAAS_DOCS_ORIGIN, "https://app.langwatch.ai"]);
  });

  it("registers only the app's own origin on a self-hosted install that names none", () => {
    expect(
      registeredDocsOrigins({
        configured: undefined,
        isSaas: false,
        publicBaseUrl: "https://langwatch.internal:8443/",
      }),
    ).toEqual(["https://langwatch.internal:8443"]);
  });

  it("keeps the configured list and adds the app's own origin", () => {
    expect(
      registeredDocsOrigins({
        configured: ["https://docs.internal"],
        isSaas: true,
        publicBaseUrl: "https://app.langwatch.ai/",
      }),
    ).toEqual(["https://docs.internal", "https://app.langwatch.ai"]);
  });
});

describe("isRegisteredDocsOrigin", () => {
  const registered = ["https://langwatch.ai"];

  it.each([
    "https://langwatch.ai.evil.com",
    "https://evil.langwatch.ai",
    "http://langwatch.ai",
    "https://langwatch.ai/",
    "https://LANGWATCH.ai",
    "null",
  ])("refuses %s, which only resembles a registered origin", (origin) => {
    expect(isRegisteredDocsOrigin({ origin, registered })).toBe(false);
  });

  it("accepts the exact origin", () => {
    expect(isRegisteredDocsOrigin({ origin: "https://langwatch.ai", registered })).toBe(true);
  });
});
