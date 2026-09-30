// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type { GuidedOnboardingRecordedEventData } from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import {
  checkoutCompletedSignal,
  evaluationCompletedSignal,
  evaluationRanSignal,
  experimentRanSignal,
  guidedOnboardingSignal,
  subscriptionChangedSignal,
} from "../nurturing-owner-signals.rules.ts";

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

describe("evaluationRanSignal", () => {
  it("names the person and project, keyed by aggregate, person and instant", () => {
    expect(
      evaluationRanSignal({
        aggregateId: "project-1",
        data: { tenantId: "project-1", occurredAt: 5, userId: "user-1", projectId: "project-1" },
      }),
    ).toMatchObject({
      kind: "evaluation_ran",
      sourceEventId: "project-1:user-1:5",
      userId: "user-1",
    });
  });
});

describe("evaluationCompletedSignal", () => {
  it("carries the admin, the outcome and the organization count, keyed by the evaluation", () => {
    expect(
      evaluationCompletedSignal({
        aggregateId: "org-1",
        data: {
          tenantId: "project-1",
          occurredAt: 5,
          userId: "admin-1",
          projectId: "project-1",
          evaluationId: "eval-1",
          score: 0.5,
          organizationEvaluationCount: 3,
        },
      }),
    ).toMatchObject({
      kind: "evaluation_completed",
      sourceEventId: "org-1:eval-1",
      userId: "admin-1",
      organizationEvaluationCount: 3,
    });
  });
});

describe("subscriptionChangedSignal", () => {
  it("carries every member and whether the organization still subscribes", () => {
    expect(
      subscriptionChangedSignal({
        aggregateId: "org-1",
        data: {
          tenantId: "org-1",
          occurredAt: 7,
          organizationId: "org-1",
          memberUserIds: ["user-1", "user-2"],
          hasSubscription: false,
        },
      }),
    ).toMatchObject({
      kind: "subscription_changed",
      sourceEventId: "org-1:subscription:false:7",
      memberUserIds: ["user-1", "user-2"],
      hasSubscription: false,
    });
  });
});

describe("checkoutCompletedSignal", () => {
  it("is keyed by the subscription so a redelivered webhook raises it once", () => {
    expect(
      checkoutCompletedSignal({
        aggregateId: "org-1",
        data: {
          tenantId: "org-1",
          occurredAt: 9,
          organizationId: "org-1",
          subscriptionId: "sub-1",
          checkoutCreatedAt: "2026-09-30T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      kind: "checkout_completed",
      sourceEventId: "org-1:sub-1",
      subscriptionId: "sub-1",
      checkoutCreatedAt: "2026-09-30T00:00:00.000Z",
    });
  });
});
