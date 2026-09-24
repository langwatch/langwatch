// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A written scenario's product event carries the organization's onboarding
 * variant, as main's scenario router tagged it, and nurturing gets the count.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ScenarioCreatedSignal } from "@langwatch/enterprise-billing-contract";
import { EMPTY_GUIDED_ONBOARDING_STATE } from "@langwatch/onboarding-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import {
  ScenarioCreatedSignalService,
  type ScenarioSignalOrganizations,
} from "../scenario-created-signal.service.ts";

const signal: ScenarioCreatedSignal = {
  userId: "user_1",
  projectId: "project_1",
  scenarioId: "scenario_1",
  scenarioCount: 3,
};

const at = new Date("2026-09-01T00:00:00.000Z");
const project = {
  id: "project_1",
  name: "Project",
  slug: "project",
  apiKey: "sk-lw-test",
  lwqlKey: "lwql-test",
  teamId: "team_1",
  language: "python",
  framework: "other",
  kind: "application",
  firstMessage: false,
  integrated: false,
  createdAt: at,
  updatedAt: at,
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

function build(variant: "guided" | "classic" | null) {
  const posthog = MemoryPostHogChannel.create();
  const nurtured: ScenarioCreatedSignal[] = [];
  const service = ScenarioCreatedSignalService.create({
    organizations: createApiFixture<ScenarioSignalOrganizations>({
      findProject: async () => project,
      getOrganizationIdByTeamId: async () => "org_1",
      readGuidedOnboardingState: async () => ({ state: EMPTY_GUIDED_ONBOARDING_STATE, variant }),
    }),
    posthog,
    nurture: (input) => nurtured.push(input),
  });
  return { service, posthog, nurtured };
}

describe("ScenarioCreatedSignalService", () => {
  describe("when the organization went through the guided onboarding", () => {
    it("tags scenario_created with the variant and the experiment property", async () => {
      const { service, posthog } = build("guided");

      await service.record(signal);

      expect(posthog.tracked).toEqual([
        {
          userId: "user_1",
          event: "scenario_created",
          properties: {
            onboarding_variant: "guided",
            "$feature/experiment_onboarding_langy_guided": "guided",
            projectId: "project_1",
          },
        },
      ]);
    });

    it("names the classic onboarding control, as the experiment calls it", async () => {
      const { service, posthog } = build("classic");

      await service.record(signal);

      expect(posthog.tracked[0]?.properties).toMatchObject({
        onboarding_variant: "classic",
        "$feature/experiment_onboarding_langy_guided": "control",
      });
    });
  });

  describe("when the organization predates the experiment", () => {
    it("sends scenario_created with the project alone", async () => {
      const { service, posthog } = build(null);

      await service.record(signal);

      expect(posthog.tracked[0]?.properties).toEqual({ projectId: "project_1" });
    });
  });

  it("hands nurturing the scenario and the project's count", async () => {
    const { service, nurtured } = build("guided");

    await service.record(signal);

    expect(nurtured).toEqual([signal]);
  });
});
