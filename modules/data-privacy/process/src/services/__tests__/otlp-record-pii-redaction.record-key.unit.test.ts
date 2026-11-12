/**
 * A log record's or metric point's own key travels with its strict batch to the model call, so
 * identical texts sent at different times are priced as separate requests (ADR-201).
 * Spec: specs/pii-redaction-billing.feature
 */
import { EMPTY_AUDIENCE, type ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { DataPrivacyResolutionFake } from "../../app/__tests__/data-privacy.fixture.ts";
import type { PiiClearing } from "../../rules/pii-analysis.rules.ts";
import { OtlpSpanPiiRedactionService } from "../otlp-span-pii-redaction.service.ts";
import type { PiiAnalysisService } from "../pii-analysis.service.ts";

const TENANT = createTenantId("project-web-app");
const TEXT = "the ticket was raised by Jane Doe in Berlin";

const cat = () => ({ disposition: "capture" as const, audience: { ...EMPTY_AUDIENCE } });

const STRICT: ResolvedDataPrivacy = {
  categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
  pii: { level: "strict", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  customAttributes: [],
};

/** The redaction service with only the analysis transport doubled; `recordKeys` is its intake. */
function makeService() {
  const recordKeys: (string | undefined)[] = [];
  const transport: Pick<PiiAnalysisService, "clearGoogleDlp" | "clearPresidio" | "close"> = {
    clearGoogleDlp: async (): Promise<PiiClearing> => ({ kind: "unchanged" }),
    clearPresidio: async ({ texts, recordKey }) => {
      recordKeys.push(recordKey);
      return texts.map(() => null);
    },
    close: async () => undefined,
  };
  const service = OtlpSpanPiiRedactionService.create({
    transport,
    isLangevalsConfigured: async () => true,
    isProduction: false,
    nativePolicyEnforced: true,
    piiRedactionMaxAttributeLength: 250_000,
    dataPrivacy: new DataPrivacyResolutionFake(STRICT),
  });

  return { service, recordKeys };
}

describe("given a strict tenant and a record key", () => {
  /** @scenario "A log record's or metric point's key reaches the model call" */
  it("sends a log record's key with its batch", async () => {
    const { service, recordKeys } = makeService();

    await service.redactLog(
      { body: TEXT, attributes: {}, resourceAttributes: {}, recordKey: "log:1700000000123456789" },
      "STRICT",
      TENANT,
    );

    expect(recordKeys).toEqual(["log:1700000000123456789"]);
  });

  /** @scenario "A log record's or metric point's key reaches the model call" */
  it("sends a metric point's key with its batch", async () => {
    const { service, recordKeys } = makeService();

    await service.redactMetricAttributes(
      {
        attributes: { "app.note": TEXT },
        resourceAttributes: {},
        recordKey: "metric:http.requests:0:1700000000000000000",
      },
      "STRICT",
      TENANT,
    );

    expect(recordKeys).toEqual(["metric:http.requests:0:1700000000000000000"]);
  });

  /** @scenario "A batch given no record key is keyed by its own text" */
  it("sends no key for a log record redacted without one", async () => {
    const { service, recordKeys } = makeService();

    await service.redactLog(
      { body: TEXT, attributes: {}, resourceAttributes: {} },
      "STRICT",
      TENANT,
    );

    expect(recordKeys).toEqual([undefined]);
  });
});
