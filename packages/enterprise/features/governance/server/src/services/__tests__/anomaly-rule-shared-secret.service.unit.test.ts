// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A reader is shown a marker where the destination's shared secret is stored,
 * so an admin who edits a rule they were never shown the secret of must not
 * save the marker over it.
 *
 * Covers @unit scenarios from
 * specs/security/feature-surface-secret-disclosure.feature.
 */
import { SHARED_SECRET_REDACTED, type AnomalyRule } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { AnomalyRuleRepository, type AnomalyRuleChanges } from "../../ports/anomaly-rule.port";
import { AnomalyRuleService } from "../anomaly-rule.service";

const STORED_SECRET = "TheRealSigningSecret";

function storedRule(destinationConfig: unknown): AnomalyRule {
  return {
    id: "rule-1",
    organizationId: "organization-1",
    scope: "organization",
    scopeId: "organization-1",
    name: "Spend spike",
    description: null,
    severity: "warning",
    ruleType: "spend_spike",
    thresholdConfig: { windowSec: 3600, ratioVsBaseline: 2.5, minBaselineUsd: 1 },
    destinationConfig,
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-08-24T10:00:00.000Z"),
    updatedAt: new Date("2026-08-24T10:00:00.000Z"),
    createdById: "user-1",
  } as AnomalyRule;
}

class InMemoryAnomalyRules extends AnomalyRuleRepository {
  applied: AnomalyRuleChanges | null = null;

  constructor(private readonly row: AnomalyRule) {
    super();
  }

  async list() {
    return [this.row];
  }

  async tryFindById() {
    return this.row;
  }

  async create() {
    return this.row;
  }

  async update(_id: string, changes: AnomalyRuleChanges) {
    this.applied = changes;
    return { ...this.row, ...changes } as AnomalyRule;
  }
}

const destination = (sharedSecret: string | undefined) => ({
  destinations: [
    {
      type: "webhook",
      url: "https://siem.example/ingest",
      ...(sharedSecret === undefined ? {} : { sharedSecret }),
    },
  ],
});

describe("AnomalyRuleService.updateRule", () => {
  describe("given a rule whose destination carries a shared secret", () => {
    describe("when the admin saves the config they were shown", () => {
      /** @scenario "An edit that sends the marker back keeps the stored shared secret" */
      it("keeps the stored secret rather than saving the marker", async () => {
        const repository = new InMemoryAnomalyRules(storedRule(destination(STORED_SECRET)));
        const service = AnomalyRuleService.create({ repository });

        await service.updateRule({
          id: "rule-1",
          organizationId: "organization-1",
          destinationConfig: destination(SHARED_SECRET_REDACTED),
        });

        expect(repository.applied?.destinationConfig).toEqual(destination(STORED_SECRET));
      });

      it("takes a newly typed secret over the stored one", async () => {
        const repository = new InMemoryAnomalyRules(storedRule(destination(STORED_SECRET)));
        const service = AnomalyRuleService.create({ repository });

        await service.updateRule({
          id: "rule-1",
          organizationId: "organization-1",
          destinationConfig: destination("a-rotated-secret"),
        });

        expect(repository.applied?.destinationConfig).toEqual(destination("a-rotated-secret"));
      });
    });
  });

  describe("given a rule whose destination carries no shared secret", () => {
    describe("when the admin saves a destination carrying only the marker", () => {
      /** @scenario "A marker sent for a destination we hold no secret for is refused" */
      it("refuses the save rather than signing with the marker", async () => {
        const repository = new InMemoryAnomalyRules(storedRule(destination(undefined)));
        const service = AnomalyRuleService.create({ repository });

        await expect(
          service.updateRule({
            id: "rule-1",
            organizationId: "organization-1",
            destinationConfig: destination(SHARED_SECRET_REDACTED),
          }),
        ).rejects.toMatchObject({ code: "validation_error" });
        expect(repository.applied).toBeNull();
      });
    });
  });
});
