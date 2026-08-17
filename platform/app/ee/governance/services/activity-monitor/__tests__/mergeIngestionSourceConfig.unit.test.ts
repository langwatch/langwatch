/**
 * Unit coverage for pull/parser config merge precedence.
 *
 * Extracted from the Prisma create() call so this is provable without a
 * database. The interesting case is narrow: `parserConfig` wins in general,
 * and must NOT win for the three keys that decide which puller runs, how it
 * authenticates, and when.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { describe, expect, it } from "vitest";

import {
  mergeIngestionSourceConfig,
  PULL_CONFIG_OWNED_FIELDS,
} from "../mergeIngestionSourceConfig";

describe("mergeIngestionSourceConfig", () => {
  /** @scenario parserConfig cannot override pullConfig-owned fields */
  it("keeps the pullConfig value for every owned key and strips the parserConfig one", () => {
    const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig({
      pullConfig: {
        adapter: "microsoft_365_audit",
        credentials: { clientSecret: "the-real-secret" },
        schedule: "*/15 * * * *",
        tenantId: "acme-tenant",
      },
      parserConfig: {
        // All three would silently redirect or de-authenticate the puller.
        adapter: "http_polling",
        credentials: { clientSecret: "" },
        schedule: "* * * * *",
        // A genuine parser-side key, which must survive untouched.
        ottlStatements: ['set(attributes["a"], 1)'],
      },
    });

    expect(merged.adapter).toBe("microsoft_365_audit");
    expect(merged.credentials).toEqual({ clientSecret: "the-real-secret" });
    expect(merged.schedule).toBe("*/15 * * * *");
    expect(merged.tenantId).toBe("acme-tenant");
    expect(merged.ottlStatements).toEqual(['set(attributes["a"], 1)']);

    expect([...strippedFromParserConfig].sort()).toEqual(
      [...PULL_CONFIG_OWNED_FIELDS].sort(),
    );
  });

  it("lets parserConfig win for keys pullConfig does not own", () => {
    const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig({
      pullConfig: {
        adapter: "microsoft_365_audit",
        contentType: "Audit.General",
      },
      parserConfig: { contentType: "Audit.AzureActiveDirectory" },
    });

    expect(merged.contentType).toBe("Audit.AzureActiveDirectory");
    expect(strippedFromParserConfig).toEqual([]);
  });

  it("leaves a push-mode source with no pullConfig entirely alone", () => {
    const parserConfig = {
      adapter: "something-a-push-source-set",
      schedule: "irrelevant",
      sharedSecretLastFour: "1234",
    };

    const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig({
      parserConfig,
    });

    // Nothing is stripped when pullConfig never supplied the key — there is
    // no conflict to resolve, so there is nothing to protect.
    expect(merged).toEqual(parserConfig);
    expect(strippedFromParserConfig).toEqual([]);
  });

  it("handles both sides being absent", () => {
    expect(mergeIngestionSourceConfig({})).toEqual({
      merged: {},
      strippedFromParserConfig: [],
    });
  });
});
