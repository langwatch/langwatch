// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type { GuidedOnboardingRecordedEventData } from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import { experimentRanSignal, guidedOnboardingSignal } from "../nurturing-owner-signals.rules.ts";

const recorded: Omit<GuidedOnboardingRecordedEventData, "event"> = {
  tenantId: "org-1",
  occurredAt: 1_700_000_000_000,
  organizationId: "org-1",
  userId: "user-1",
  payload: {},
  previousPaths: [],
  state: { paths: ["gateway", "llmops"], donePaths: [] },
};

describe("guidedOnboardingSignal", () => {
  it("raises the picks as a paths signal keyed by the aggregate, event and instant", () => {
    expect(
      guidedOnboardingSignal({
        aggregateId: "org-1",
        data: { ...recorded, event: "paths_selected" },
      }),
    ).toEqual({
      kind: "guided_onboarding_paths",
      sourceEventId: "org-1:paths_selected:1700000000000",
      tenantId: "org-1",
      occurredAt: 1_700_000_000_000,
      userId: "user-1",
      organizationId: "org-1",
      event: "paths_selected",
      previousPaths: [],
      paths: ["gateway", "llmops"],
    });
  });

  it("raises a finished step as a progress signal carrying the payload and state", () => {
    expect(
      guidedOnboardingSignal({
        aggregateId: "org-1",
        data: { ...recorded, event: "path_completed", payload: { path: "gateway" } },
      }),
    ).toMatchObject({
      kind: "guided_onboarding_progress",
      event: "path_completed",
      payload: { path: "gateway" },
      state: recorded.state,
    });
  });
});

describe("experimentRanSignal", () => {
  it("carries whether the run was in full and which saved experiment it was", () => {
    expect(
      experimentRanSignal({
        aggregateId: "project-1",
        data: {
          tenantId: "project-1",
          occurredAt: 1_700_000_000_000,
          userId: "user-1",
          projectId: "project-1",
          experimentId: "exp-1",
          fullRun: true,
        },
      }),
    ).toMatchObject({ kind: "experiment_ran", experimentId: "exp-1", fullRun: true });
  });
});
