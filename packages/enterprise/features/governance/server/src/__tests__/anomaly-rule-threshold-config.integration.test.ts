/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { safeParseSpendSpikeThresholdConfig } from "@langwatch/enterprise-governance-contract";
import { PrismaAnomalyRuleRepository } from "../repositories/prisma/prisma.anomaly-rule.repository";
import { AnomalyRuleService } from "../services/anomaly-rule.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = `tcfg-${nanoid(8)}`;
const ORG_ID = `org-${ns}`;
const ADMIN_ID = `usr-admin-${ns}`;

const validSpendSpikeConfig = {
  windowSec: 3600,
  ratioVsBaseline: 2.5,
  minBaselineUsd: 1.0,
};

const baseInput = (suffix: string) => ({
  organizationId: ORG_ID,
  name: `rule-${suffix}-${ns}`,
  severity: "warning" as const,
  ruleType: "spend_spike",
  scope: "organization" as const,
  scopeId: ORG_ID,
  actorUserId: ADMIN_ID,
});

describe.skipIf(!databaseUrl)("AnomalyRule.thresholdConfig — structured schema", () => {
  const service = () =>
    AnomalyRuleService.create({ repository: PrismaAnomalyRuleRepository.create(prisma) });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: ns, slug: ORG_ID },
    });
    await prisma.user.create({
      data: { id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin" },
    });
  });

  afterAll(async () => {
    await prisma.anomalyRule.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
  });

  describe("when a valid config is supplied", () => {
    /** @scenario "A valid spend_spike threshold config persists unchanged" */
    it("persists a valid spend_spike config exactly as supplied", async () => {
      const created = await service().createRule({
        ...baseInput("valid"),
        thresholdConfig: validSpendSpikeConfig,
      });
      expect(created.thresholdConfig).toEqual(validSpendSpikeConfig);

      const persisted = await prisma.anomalyRule.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.thresholdConfig).toEqual(validSpendSpikeConfig);
    });
  });

  describe("when the config does not match the rule type's schema", () => {
    /** @scenario "Invalid spend_spike configs are rejected as validation errors" */
    it.each([
      ["missing all fields", {}],
      ["windowSec is negative", { windowSec: -1, ratioVsBaseline: 2.0, minBaselineUsd: 1.0 }],
      ["ratioVsBaseline is zero", { windowSec: 3600, ratioVsBaseline: 0, minBaselineUsd: 1.0 }],
      [
        "minBaselineUsd is negative",
        { windowSec: 3600, ratioVsBaseline: 2.0, minBaselineUsd: -1.0 },
      ],
      ["windowSec is a string", { windowSec: "3600", ratioVsBaseline: 2.0, minBaselineUsd: 1.0 }],
      ["snake_case typo", { window_sec: 3600, ratio_vs_baseline: 2.5, min_baseline_usd: 1.0 }],
    ])("rejects %s", async (_label, badConfig) => {
      const name = `rule-bad-${nanoid(4).toLowerCase()}-${ns}`;
      await expect(
        service().createRule({
          ...baseInput("bad"),
          name,
          thresholdConfig: badConfig as Record<string, unknown>,
        }),
      ).rejects.toMatchObject({
        // The strict schema's own complaint, one issue per offending key.
        issues: expect.any(Array),
      });

      const persisted = await prisma.anomalyRule.findFirst({
        where: { organizationId: ORG_ID, name },
      });
      expect(persisted).toBeNull();
    });

    /** @scenario "Unknown ruleType is rejected as a validation error listing the allowed types" */
    it("rejects an unknown ruleType as a handled validation error", async () => {
      await expect(
        service().createRule({
          ...baseInput("unknown-type"),
          ruleType: "future_rule_type",
          thresholdConfig: validSpendSpikeConfig,
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { formErrors: [expect.stringContaining("spend_spike")] },
      });

      const persisted = await prisma.anomalyRule.findFirst({
        where: { organizationId: ORG_ID, ruleType: "future_rule_type" },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("when an existing rule is updated", () => {
    /** @scenario "Updating an existing rule with an invalid thresholdConfig is rejected" */
    it("rejects an update with bad thresholdConfig and leaves the row unchanged", async () => {
      const created = await service().createRule({
        ...baseInput("update-target"),
        thresholdConfig: validSpendSpikeConfig,
      });

      await expect(
        service().updateRule({
          organizationId: ORG_ID,
          id: created.id,
          thresholdConfig: { windowSec: -1 } as Record<string, unknown>,
        }),
      ).rejects.toMatchObject({ issues: expect.any(Array) });

      const persisted = await prisma.anomalyRule.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.thresholdConfig).toEqual(validSpendSpikeConfig);
    });

    /** @scenario "Updating ruleType requires a matching thresholdConfig" */
    it("rejects switching ruleType to an unknown type without a matching config", async () => {
      const created = await service().createRule({
        ...baseInput("type-switch"),
        thresholdConfig: validSpendSpikeConfig,
      });

      await expect(
        service().updateRule({
          organizationId: ORG_ID,
          id: created.id,
          ruleType: "future_rule_type",
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { formErrors: [expect.stringContaining("future_rule_type")] },
      });

      const persisted = await prisma.anomalyRule.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.ruleType).toBe("spend_spike");
    });
  });

  describe("when the evaluator reads a row's config", () => {
    it("returns ok=true for a valid config", () => {
      const result = safeParseSpendSpikeThresholdConfig(validSpendSpikeConfig);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(validSpendSpikeConfig);
    });

    /** @scenario "Stale row that fails strict validation logs a warning and skips" */
    it("returns ok=false with a ZodError for stale snake_case rows", () => {
      // Pre-Phase-2C rows could legitimately have shapes like this. The
      // evaluator safeParses to skip + log instead of crashing or silently
      // substituting DEFAULT_SPEND_SPIKE_CONFIG.
      const stale = { window_sec: 3600, ratio_vs_baseline: 2.5 };
      const result = safeParseSpendSpikeThresholdConfig(stale);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });
});
