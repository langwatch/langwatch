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
  describe("given a parserConfig that collides with pullConfig-owned keys", () => {
    describe("when the two are merged", () => {
      /** @scenario "parserConfig cannot override pullConfig-owned fields" */
      it("keeps the pullConfig value for every owned key and strips the parserConfig one", () => {
        const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig(
          {
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
          },
        );

        expect(merged.adapter).toBe("microsoft_365_audit");
        expect(merged.credentials).toEqual({ clientSecret: "the-real-secret" });
        expect(merged.schedule).toBe("*/15 * * * *");
        expect(merged.tenantId).toBe("acme-tenant");
        expect(merged.ottlStatements).toEqual(['set(attributes["a"], 1)']);

        expect([...strippedFromParserConfig].sort()).toEqual(
          [...PULL_CONFIG_OWNED_FIELDS].sort(),
        );
      });
    });
  });

  describe("given a key that pullConfig does not own", () => {
    describe("when the two are merged", () => {
      it("lets parserConfig win for keys pullConfig does not own", () => {
        // `timestampField` is a parsing concern: it changes how a fetched record
        // is read, not which feed is fetched. Deliberately not `contentType` —
        // that one picks the audit feed, so the adapter owns it and this test
        // used to prove the opposite.
        const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig(
          {
            pullConfig: {
              adapter: "microsoft_365_audit",
              timestampField: "CreationTime",
            },
            parserConfig: { timestampField: "RecordCreationTime" },
          },
        );

        expect(merged.timestampField).toBe("RecordCreationTime");
        expect(strippedFromParserConfig).toEqual([]);
      });
    });
  });

  describe("given a push-mode source that supplied no pullConfig", () => {
    describe("when the merge runs with only a parserConfig", () => {
      it("leaves a push-mode source with no pullConfig entirely alone", () => {
        const parserConfig = {
          adapter: "something-a-push-source-set",
          schedule: "irrelevant",
          sharedSecretLastFour: "1234",
        };

        const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig(
          {
            parserConfig,
          },
        );

        // Nothing is stripped when pullConfig never supplied the key — there is
        // no conflict to resolve, so there is nothing to protect.
        expect(merged).toEqual(parserConfig);
        expect(strippedFromParserConfig).toEqual([]);
      });
    });
  });

  describe("given neither a pullConfig nor a parserConfig", () => {
    describe("when the merge runs with nothing to merge", () => {
      it("handles both sides being absent", () => {
        expect(mergeIngestionSourceConfig({})).toEqual({
          merged: {},
          strippedFromParserConfig: [],
        });
      });
    });
  });

  describe("given a parserConfig that would repoint a microsoft_365_audit source", () => {
    describe("when the two are merged", () => {
      /** @scenario "parserConfig cannot repoint a microsoft_365_audit source" */
      it("keeps the composer's tenant and content type over a caller's parserConfig", () => {
        // Both are well-formed strings, so the adapter's own schema would accept
        // either. Precedence is the only thing standing between a caller and a
        // source that quietly polls a different tenant's audit feed.
        const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig(
          {
            pullConfig: {
              adapter: "microsoft_365_audit",
              tenantId: "acme-tenant-guid",
              contentType: "Audit.General",
            },
            parserConfig: {
              tenantId: "someone-elses-tenant-guid",
              contentType: "Audit.Exchange",
              stripPrompts: true,
            },
          },
        );

        expect(merged.tenantId).toBe("acme-tenant-guid");
        expect(merged.contentType).toBe("Audit.General");
        // Parsing hints are still the caller's to set.
        expect(merged.stripPrompts).toBe(true);
        expect(strippedFromParserConfig.toSorted()).toEqual([
          "contentType",
          "tenantId",
        ]);
      });
    });
  });

  describe("given an adapter that does not own tenantId", () => {
    describe("when the two are merged", () => {
      it("leaves those keys alone for adapters that do not own them", () => {
        // The protection is keyed on the adapter, not on the field name, so an
        // unrelated puller keeps the general parserConfig-wins rule.
        const { merged, strippedFromParserConfig } = mergeIngestionSourceConfig(
          {
            pullConfig: { adapter: "http_custom", tenantId: "from-pull" },
            parserConfig: { tenantId: "from-parser" },
          },
        );

        expect(merged.tenantId).toBe("from-parser");
        expect(strippedFromParserConfig).toEqual([]);
      });
    });
  });
});
