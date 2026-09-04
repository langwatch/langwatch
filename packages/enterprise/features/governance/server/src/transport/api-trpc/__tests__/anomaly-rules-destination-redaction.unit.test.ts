// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The shared secret on an anomaly rule's destination is the HMAC key that
 * signs the customer's own SIEM alerts. It was returned in full to anyone
 * holding `anomalyRules:view`.
 *
 * Covers @unit scenarios from
 * specs/security/feature-surface-secret-disclosure.feature.
 */
import { SHARED_SECRET_REDACTED } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { toAnomalyRuleDto } from "../anomaly-rules.api";

function ruleRow(destinationConfig: unknown) {
  return {
    id: "rule-1",
    organizationId: "organization-1",
    scope: "organization",
    scopeId: "organization-1",
    name: "Spend spike",
    description: null,
    severity: "warning",
    ruleType: "spend_spike",
    thresholdConfig: { multiplier: 3 },
    destinationConfig,
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-08-24T10:00:00.000Z"),
    updatedAt: new Date("2026-08-24T10:00:00.000Z"),
    createdById: "user-1",
  };
}

describe("toAnomalyRuleDto", () => {
  describe("given a rule whose destination carries a shared secret", () => {
    describe("when it is serialised for a reader", () => {
      /** @scenario "Reading an anomaly rule reports that a shared secret is set, not what it is" */
      it("returns the marker in place of the secret and nothing else changed", () => {
        const dto = toAnomalyRuleDto(
          ruleRow({
            destinations: [
              {
                type: "webhook",
                url: "https://siem.example/ingest",
                sharedSecret: "TheRealSigningSecret",
              },
            ],
          }),
        );

        expect(JSON.stringify(dto)).not.toContain("TheRealSigningSecret");
        expect(dto.destinationConfig).toEqual({
          destinations: [
            {
              type: "webhook",
              url: "https://siem.example/ingest",
              sharedSecret: SHARED_SECRET_REDACTED,
            },
          ],
        });
        expect(dto.name).toBe("Spend spike");
        expect(dto.thresholdConfig).toEqual({ multiplier: 3 });
      });

      // A config the strict schema would reject still holds whatever was
      // stored under that name, so the redaction reads the raw value.
      /** @scenario "Reading an anomaly rule reports that a shared secret is set, not what it is" */
      it("redacts a shared secret stored in a shape the schema does not know", () => {
        const dto = toAnomalyRuleDto(
          ruleRow({ legacy: { destination: { sharedSecret: "TheRealSigningSecret" } } }),
        );

        expect(JSON.stringify(dto)).not.toContain("TheRealSigningSecret");
      });
    });
  });

  describe("given a rule with no destinations", () => {
    describe("when it is serialised for a reader", () => {
      it("returns an empty config", () => {
        expect(toAnomalyRuleDto(ruleRow(null)).destinationConfig).toEqual({});
      });
    });
  });
});
