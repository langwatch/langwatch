// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The daily usage sync's schedule and the one group call it sends per organization.
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  isUsageSyncDue,
  type OrganizationUsage,
  usageGroupCall,
} from "../nurturing-organization-usage.rules.ts";

const at = (iso: string) => Date.parse(iso);

const USAGE_TRAIT_KEYS = [
  "prompt_count",
  "evaluator_count",
  "scenario_count",
  "trace_count",
  "error_count",
  "total_cost",
  "last_failed_trace_at",
];

const usage: OrganizationUsage = {
  promptCount: 2,
  evaluatorCount: 1,
  scenarioCount: 0,
  traceCount: 3,
  errorCount: 1,
  totalCost: 0.42,
  lastFailedTraceAt: at("2026-11-05T10:00:00.750Z"),
};

describe("isUsageSyncDue", () => {
  describe("given the last sync was asked for yesterday", () => {
    const lastSyncAt = at("2026-11-05T05:10:00Z");

    /** @scenario The sync waits for 05:00 UTC */
    it("is not due at 04:59 UTC", () => {
      expect(isUsageSyncDue({ at: at("2026-11-06T04:59:00Z"), lastSyncAt })).toBe(false);
    });

    it("is due at 05:00 UTC", () => {
      expect(isUsageSyncDue({ at: at("2026-11-06T05:00:00Z"), lastSyncAt })).toBe(true);
    });
  });

  describe("given the sync was already asked for after today's 05:00 UTC", () => {
    it("is not due again that day", () => {
      const lastSyncAt = at("2026-11-06T05:10:00Z");

      expect(isUsageSyncDue({ at: at("2026-11-06T23:10:00Z"), lastSyncAt })).toBe(false);
    });
  });
});

describe("usageGroupCall", () => {
  describe("given an organization's counts and a failed trace", () => {
    /** @scenario An active organization's usage reaches Customer.io as one group call */
    it("groups the admin into the organization with the counts and the failed time in seconds", () => {
      const call = usageGroupCall({
        organizationId: "org-1",
        adminUserId: "admin-1",
        usage,
      });

      expect(call).toEqual({
        type: "group",
        userId: "admin-1",
        groupId: "org-1",
        traits: {
          prompt_count: 2,
          evaluator_count: 1,
          scenario_count: 0,
          trace_count: 3,
          error_count: 1,
          total_cost: 0.42,
          last_failed_trace_at: Math.floor(at("2026-11-05T10:00:00Z") / 1000),
        },
      });
    });

    /** @scenario The group call carries only the usage traits */
    it("sends exactly the usage traits, so name, plan, size and onboarding stay as they are", () => {
      const call = usageGroupCall({
        organizationId: "org-1",
        adminUserId: "admin-1",
        usage,
      });

      expect(call.type === "group" && Object.keys(call.traits ?? {}).toSorted()).toEqual(
        USAGE_TRAIT_KEYS.toSorted(),
      );
    });
  });

  describe("given an organization with nothing", () => {
    /** @scenario An organization with nothing gets zeros */
    it("sends zeros and no failed time", () => {
      const call = usageGroupCall({
        organizationId: "org-1",
        adminUserId: "admin-1",
        usage: {
          promptCount: 0,
          evaluatorCount: 0,
          scenarioCount: 0,
          traceCount: 0,
          errorCount: 0,
          totalCost: 0,
          lastFailedTraceAt: null,
        },
      });

      expect(call).toMatchObject({
        traits: {
          prompt_count: 0,
          evaluator_count: 0,
          scenario_count: 0,
          trace_count: 0,
          error_count: 0,
          total_cost: 0,
        },
      });
      expect(call.type === "group" && Object.keys(call.traits ?? {})).not.toContain(
        "last_failed_trace_at",
      );
    });
  });
});
