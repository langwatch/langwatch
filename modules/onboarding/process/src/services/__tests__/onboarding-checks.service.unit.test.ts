import type { AuthzApi, AuthzTeamMemberBinding } from "@langwatch/authz-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import type { DatasetApi, DatasetSummary } from "@langwatch/dataset-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import {
  EMPTY_GUIDED_ONBOARDING_STATE,
  integrationsCheckStatusSchema,
  type GuidedOnboardingState,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi, SimulationSetData } from "@langwatch/scenario-contract";
/** @see modules/onboarding/specs/integrations-checks.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Workflow, WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { OnboardingChecksService } from "../onboarding-checks.service.ts";

const PROJECT_ID = "project-1";
const TEAM_ID = "team-1";
const ORGANIZATION_ID = "organization-1";

type Holdings = Readonly<{
  workflows?: number;
  charts?: number;
  datasets?: number;
  monitors?: number;
  scenarioSets?: number | "unreachable";
  modelProviders?: number;
  prompts?: number;
  memberUserIds?: readonly string[];
  guided?: GuidedOnboardingState & { variant: OnboardingVariant | null };
}>;

function many<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

function checklist(holdings: Holdings = {}) {
  const countEnabledInScopes = vi.fn(async () => holdings.modelProviders ?? 0);
  const project = createApiFixture<ProjectWithTeam>({
    id: PROJECT_ID,
    teamId: TEAM_ID,
    firstMessage: true,
    integrated: false,
    team: createApiFixture<ProjectWithTeam["team"]>({
      id: TEAM_ID,
      organizationId: ORGANIZATION_ID,
    }),
  });
  const service = OnboardingChecksService.create({
    guided: {
      getStateWithVariant: async () =>
        holdings.guided ?? { ...EMPTY_GUIDED_ONBOARDING_STATE, variant: null },
    },
    peers: {
      projects: createApiFixture<ProjectApi>({ getWithTeam: async () => project }),
      workflows: createApiFixture<WorkflowApi>({
        list: async () => many(holdings.workflows ?? 0, () => createApiFixture<Workflow>({})),
      }),
      dashboards: createApiFixture<DashboardApi>({
        countUsage: async () => ({ builderCharts: 0, charts: holdings.charts ?? 0 }),
      }),
      datasets: createApiFixture<DatasetApi>({
        listDatasets: async () => ({
          data: many(Math.min(holdings.datasets ?? 0, 1), () =>
            createApiFixture<DatasetSummary>({}),
          ),
          pagination: { page: 1, limit: 1, total: holdings.datasets ?? 0, totalPages: 1 },
        }),
      }),
      monitors: createApiFixture<MonitorApi>({
        countUsage: async () => ({ monitors: holdings.monitors ?? 0 }),
      }),
      scenarios: createApiFixture<ScenarioApi>({
        getScenarioSetsData: async () => {
          if (holdings.scenarioSets === "unreachable") throw new Error("clickhouse down");
          return many(holdings.scenarioSets ?? 0, () => createApiFixture<SimulationSetData>({}));
        },
      }),
      modelProviders: createApiFixture<ModelProviderApi>({ countEnabledInScopes }),
      prompts: createApiFixture<PromptApi>({
        countVersionedPrompts: async () => holdings.prompts ?? 0,
      }),
      permissions: createApiFixture<AuthzApi>({
        listTeamMemberBindings: async () =>
          new Map([
            [
              TEAM_ID,
              (holdings.memberUserIds ?? []).map((userId) =>
                createApiFixture<AuthzTeamMemberBinding>({ userId }),
              ),
            ],
          ]),
      }),
    },
  });
  return { service, countEnabledInScopes };
}

describe("OnboardingChecksService", () => {
  describe("given every owner holds at least one of its records", () => {
    /** @scenario "Every step reads as done once its owner holds one" */
    it("reads every step as done, the team at its size, and the project's own flags", async () => {
      const { service } = checklist({
        workflows: 3,
        charts: 2,
        datasets: 4,
        monitors: 5,
        scenarioSets: 2,
        modelProviders: 3,
        prompts: 7,
        memberUserIds: ["user-1", "user-2", "user-2"],
      });

      const status = await service.getCheckStatus({ projectId: PROJECT_ID });

      expect(integrationsCheckStatusSchema.parse(status)).toEqual(status);
      expect(status).toMatchObject({
        workflows: 1,
        customGraphs: 1,
        datasets: 1,
        onlineEvaluations: 1,
        simulations: 1,
        modelProviders: 1,
        prompts: 1,
        teamMembers: 2,
        firstMessage: true,
        integrated: false,
      });
    });
  });

  describe("given a fresh project", () => {
    /** @scenario "A fresh project reports every step undone" */
    it("reports every step undone", async () => {
      const { service } = checklist();

      const status = await service.getCheckStatus({ projectId: PROJECT_ID });

      expect(status).toMatchObject({
        workflows: 0,
        customGraphs: 0,
        datasets: 0,
        onlineEvaluations: 0,
        simulations: 0,
        modelProviders: 0,
        prompts: 0,
        teamMembers: 0,
      });
      expect(status.guidedOnboarding).toEqual({ variant: null, paths: [], donePaths: [] });
    });
  });

  describe("when the scenario sets cannot be read", () => {
    /** @scenario "An unreachable simulations store leaves the step undone" */
    it("reports simulations undone instead of failing the whole check", async () => {
      const { service } = checklist({ scenarioSets: "unreachable", workflows: 1 });

      const status = await service.getCheckStatus({ projectId: PROJECT_ID });

      expect(status.simulations).toBe(0);
      expect(status.workflows).toBe(1);
    });
  });

  /** @scenario "A model provider counts through the organization and team scopes" */
  it("counts model providers across the organization, team and project scopes", async () => {
    const { service, countEnabledInScopes } = checklist({ modelProviders: 1 });

    await service.getCheckStatus({ projectId: PROJECT_ID });

    expect(countEnabledInScopes).toHaveBeenCalledWith({
      scopes: [
        { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
        { scopeType: "TEAM", scopeId: TEAM_ID },
        { scopeType: "PROJECT", scopeId: PROJECT_ID },
      ],
    });
  });

  /** @scenario "The checklist carries the organization's guided onboarding" */
  /** @scenario "the onboarding checks expose the guided state of the organization" */
  it("carries the organization's guided onboarding", async () => {
    const { service } = checklist({
      guided: {
        ...EMPTY_GUIDED_ONBOARDING_STATE,
        variant: "guided",
        paths: ["llmops", "coding"],
        currentPath: "coding",
        donePaths: ["llmops"],
      },
    });

    const status = await service.getCheckStatus({ projectId: PROJECT_ID });

    expect(status.guidedOnboarding).toEqual({
      variant: "guided",
      paths: ["llmops", "coding"],
      currentPath: "coding",
      donePaths: ["llmops"],
    });
  });

  /** @scenario "the onboarding checks expose the empty guided state for an organization that recorded none" */
  it("carries no variant, paths or done paths for an organization that recorded none", async () => {
    const { service } = checklist();

    const status = await service.getCheckStatus({ projectId: PROJECT_ID });

    expect(status.guidedOnboarding).toMatchObject({ variant: null, paths: [], donePaths: [] });
  });
});
