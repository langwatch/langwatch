// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What entitlement's Free scenario run notices tell Customer.io and PostHog.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireScenarioRunCapCustomerIo,
  fireScenarioRunCapPostHog,
  scenarioRunGraceEndedSignal,
  scenarioRunsThresholdSignal,
} from "../nurturing-scenario-run-cap.rules.ts";

const source = { aggregateId: "org-1", tenantId: "org-1", memberUserIds: ["user-1", "user-2"] };
const graceEndedAt = Date.UTC(2026, 10, 15);

const threshold = scenarioRunsThresholdSignal({
  ...source,
  data: {
    organizationId: "org-1",
    month: "2026-11",
    occurredAt: 1,
    runs: 80,
    maxPerMonth: 100,
    inGrace: false,
    graceEndsAt: graceEndedAt,
  },
});
const grace = scenarioRunGraceEndedSignal({
  ...source,
  data: {
    organizationId: "org-1",
    occurredAt: 2,
    firstRunAt: 0,
    graceEndedAt,
    maxPerMonth: 100,
  },
});

describe("fireScenarioRunCapCustomerIo", () => {
  describe("when the monthly threshold is reached", () => {
    /** @scenario Nurturing tells Customer.io and PostHog when a Free organization nears its scenario run cap */
    it("tracks scenario_runs_threshold_reached for every member with runs, limit and month", () => {
      expect(fireScenarioRunCapCustomerIo(threshold)).toEqual(
        ["user-1", "user-2"].map((userId) => ({
          type: "track",
          userId,
          event: "scenario_runs_threshold_reached",
          properties: { organizationId: "org-1", runs: 80, limit: 100, month: "2026-11" },
          messageId: `org-1:scenario_runs_threshold:2026-11:${userId}`,
        })),
      );
    });
  });

  describe("when the grace ends", () => {
    /** @scenario Nurturing tells Customer.io and PostHog when a Free organization's scenario run grace ends */
    it("tracks scenario_run_grace_ended for every member with the end and the run limit", () => {
      expect(fireScenarioRunCapCustomerIo(grace)).toEqual(
        ["user-1", "user-2"].map((userId) => ({
          type: "track",
          userId,
          event: "scenario_run_grace_ended",
          properties: {
            organizationId: "org-1",
            graceEndedAt: "2026-11-15T00:00:00Z",
            runLimit: 100,
          },
          messageId: `org-1:scenario_run_grace_ended:${userId}`,
        })),
      );
    });
  });
});

describe("fireScenarioRunCapPostHog", () => {
  it("captures one event per member grouped under the organization", () => {
    expect(fireScenarioRunCapPostHog(threshold)).toEqual(
      ["user-1", "user-2"].map((userId) => ({
        userId,
        event: "scenario_runs_threshold_reached",
        properties: {
          organizationId: "org-1",
          runs: 80,
          limit: 100,
          month: "2026-11",
          $groups: { organization: "org-1" },
        },
      })),
    );
  });
});
