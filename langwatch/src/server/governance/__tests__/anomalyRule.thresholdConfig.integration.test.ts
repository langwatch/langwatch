/**
 * @vitest-environment node
 *
 * Integration coverage for the structured threshold-config schema on
 * `AnomalyRule.thresholdConfig` (Phase 2C). Exercises:
 *
 *   1. Valid spend_spike configs round-trip through the tRPC create
 *      procedure and persist exactly as supplied.
 *   2. Invalid configs (missing fields, wrong types, negative numbers,
 *      snake_case typos) reject with TRPCError BAD_REQUEST. No row
 *      lands in PG.
 *   3. Unknown ruleType rejects with BAD_REQUEST.
 *   4. The update path also re-validates: bad config on update is
 *      rejected; existing row stays unchanged.
 *   5. The evaluator's `safeParseSpendSpikeThresholdConfig` quarantines
 *      stale rows (skip + warn) instead of silently substituting
 *      DEFAULT_SPEND_SPIKE_CONFIG and firing on the wrong threshold.
 *
 * Hits real Postgres (testcontainers); the planProvider is overridden
 * to ENTERPRISE so the Phase 4b-4/5 license gate doesn't block the
 * fixture flow.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FREE_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";

import { prisma } from "../../db";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";

import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";
import { safeParseSpendSpikeThresholdConfig } from "../activity-monitor/thresholdConfig.schema";

const ns = `tcfg-${nanoid(8)}`;
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

let organizationId: string;
let adminUserId: string;

beforeAll(async () => {
  resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => enterprisePlan,
    }),
  });

  const organization = await prisma.organization.create({
    data: { name: `Threshold Org ${ns}`, slug: `--tcfg-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `Threshold Team ${ns}`,
      slug: `--tcfg-team-${ns}`,
      organizationId,
    },
  });

  const admin = await prisma.user.create({
    data: { name: "Admin", email: `tcfg-admin-${ns}@example.com` },
  });
  adminUserId = admin.id;
  await prisma.organizationUser.create({
    data: { userId: admin.id, organizationId, role: OrganizationUserRole.ADMIN },
  });
  await prisma.teamUser.create({
    data: { userId: admin.id, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId: admin.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });
});

afterAll(async () => {
  await prisma.anomalyRule.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.roleBinding.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.teamUser
    .deleteMany({ where: { team: { slug: { startsWith: `--tcfg-team-` } } } })
    .catch(() => {});
  await prisma.organizationUser.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.team.deleteMany({ where: { slug: { startsWith: `--tcfg-team-` } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { slug: `--tcfg-${ns}` } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: `tcfg-admin-${ns}@example.com` } }).catch(() => {});
});

function callerFor(userId: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" } as any,
  });
  return appRouter.createCaller(ctx);
}

const validSpendSpikeConfig = {
  windowSec: 3600,
  ratioVsBaseline: 2.5,
  minBaselineUsd: 1.0,
};

const baseInput = (suffix: string) => ({
  organizationId,
  name: `rule-${suffix}-${ns}`,
  severity: "warning" as const,
  ruleType: "spend_spike",
  scope: "organization" as const,
  scopeId: organizationId,
});

describe("AnomalyRule.thresholdConfig — structured schema", () => {
  describe("valid configs round-trip", () => {
    it("persists a valid spend_spike config exactly as supplied", async () => {
      const caller = callerFor(adminUserId);
      const created = await caller.anomalyRules.create({
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

  describe("invalid configs are rejected with BAD_REQUEST", () => {
    it.each([
      ["missing all fields", {}],
      [
        "windowSec is negative",
        { windowSec: -1, ratioVsBaseline: 2.0, minBaselineUsd: 1.0 },
      ],
      [
        "ratioVsBaseline is zero",
        { windowSec: 3600, ratioVsBaseline: 0, minBaselineUsd: 1.0 },
      ],
      [
        "minBaselineUsd is negative",
        { windowSec: 3600, ratioVsBaseline: 2.0, minBaselineUsd: -1.0 },
      ],
      [
        "windowSec is a string",
        { windowSec: "3600", ratioVsBaseline: 2.0, minBaselineUsd: 1.0 },
      ],
      [
        "snake_case typo",
        { window_sec: 3600, ratio_vs_baseline: 2.5, min_baseline_usd: 1.0 },
      ],
    ])("rejects %s", async (_label, badConfig) => {
      const caller = callerFor(adminUserId);
      await expect(
        caller.anomalyRules.create({
          ...baseInput(`bad-${nanoid(4).toLowerCase()}`),
          thresholdConfig: badConfig as Record<string, unknown>,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("thresholdConfig"),
      });
    });

    it("rejects an unknown ruleType with BAD_REQUEST", async () => {
      const caller = callerFor(adminUserId);
      await expect(
        caller.anomalyRules.create({
          ...baseInput("unknown-type"),
          ruleType: "future_rule_type",
          thresholdConfig: validSpendSpikeConfig,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/Unsupported ruleType/i),
      });

      const persisted = await prisma.anomalyRule.findFirst({
        where: { organizationId, ruleType: "future_rule_type" },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("update path re-validates", () => {
    it("rejects an update with bad thresholdConfig and leaves the row unchanged", async () => {
      const caller = callerFor(adminUserId);
      const created = await caller.anomalyRules.create({
        ...baseInput("update-target"),
        thresholdConfig: validSpendSpikeConfig,
      });

      await expect(
        caller.anomalyRules.update({
          organizationId,
          id: created.id,
          thresholdConfig: { windowSec: -1 } as Record<string, unknown>,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const persisted = await prisma.anomalyRule.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.thresholdConfig).toEqual(validSpendSpikeConfig);
    });

    it("rejects switching ruleType to an unknown type without a matching config", async () => {
      const caller = callerFor(adminUserId);
      const created = await caller.anomalyRules.create({
        ...baseInput("type-switch"),
        thresholdConfig: validSpendSpikeConfig,
      });

      await expect(
        caller.anomalyRules.update({
          organizationId,
          id: created.id,
          ruleType: "future_rule_type",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/Unsupported ruleType/i),
      });

      const persisted = await prisma.anomalyRule.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.ruleType).toBe("spend_spike");
    });
  });

  describe("safeParseSpendSpikeThresholdConfig (evaluator entry)", () => {
    it("returns ok=true for a valid config", () => {
      const result = safeParseSpendSpikeThresholdConfig(validSpendSpikeConfig);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(validSpendSpikeConfig);
    });

    it("returns ok=false with a ZodError for stale snake_case rows", () => {
      // Pre-Phase-2C rows could legitimately have shapes like this.
      // The evaluator uses safeParse to skip + log instead of crashing
      // or silently substituting DEFAULT_SPEND_SPIKE_CONFIG.
      const stale = { window_sec: 3600, ratio_vs_baseline: 2.5 };
      const result = safeParseSpendSpikeThresholdConfig(stale);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });
});
