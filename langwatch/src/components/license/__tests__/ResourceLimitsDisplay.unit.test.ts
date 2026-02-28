import { describe, expect, it } from "vitest";
import {
  mapLicenseStatusToLimits,
  mapUsageToLimits,
  type ResourceLimits,
} from "../ResourceLimitsDisplay";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";

/**
 * Pure unit tests for ResourceLimitsDisplay mapping functions.
 * These are pure functions that transform data structures.
 */

describe("mapLicenseStatusToLimits", () => {
  const baseLicenseStatus = {
    currentMembers: 5,
    maxMembers: 10,
    currentMembersLite: 2,
    maxMembersLite: 5,
    currentTeams: 2,
    maxTeams: 5,
    currentProjects: 3,
    maxProjects: 10,
    currentPrompts: 8,
    maxPrompts: 20,
    currentWorkflows: 4,
    maxWorkflows: 15,
    currentScenarios: 6,
    maxScenarios: 25,
    currentEvaluators: 3,
    maxEvaluators: 10,
    currentAgents: 7,
    maxAgents: 50,
    currentExperiments: 10,
    maxExperiments: 50,
    currentMessagesPerMonth: 1500,
    maxMessagesPerMonth: 10000,
    currentEvaluationsCredit: 50,
    maxEvaluationsCredit: 100,
  };

  it("maps all license status fields to ResourceLimits format", () => {
    const result = mapLicenseStatusToLimits(baseLicenseStatus);

    expect(result).toEqual({
      members: { current: 5, max: 10 },
      membersLite: { current: 2, max: 5 },
      teams: { current: 2, max: 5 },
      projects: { current: 3, max: 10 },
      prompts: { current: 8, max: 20 },
      workflows: { current: 4, max: 15 },
      scenarios: { current: 6, max: 25 },
      evaluators: { current: 3, max: 10 },
      agents: { current: 7, max: 50 },
      experiments: { current: 10, max: 50 },
      messagesPerMonth: { current: 1500, max: 10000 },
      evaluationsCredit: { current: 50, max: 100 },
    } satisfies ResourceLimits);
  });

  it("handles zero values correctly", () => {
    const zeroStatus = {
      currentMembers: 0,
      maxMembers: 0,
      currentMembersLite: 0,
      maxMembersLite: 0,
      currentTeams: 0,
      maxTeams: 0,
      currentProjects: 0,
      maxProjects: 0,
      currentPrompts: 0,
      maxPrompts: 0,
      currentWorkflows: 0,
      maxWorkflows: 0,
      currentScenarios: 0,
      maxScenarios: 0,
      currentEvaluators: 0,
      maxEvaluators: 0,
      currentAgents: 0,
      maxAgents: 0,
      currentExperiments: 0,
      maxExperiments: 0,
      currentMessagesPerMonth: 0,
      maxMessagesPerMonth: 0,
      currentEvaluationsCredit: 0,
      maxEvaluationsCredit: 0,
    };

    const result = mapLicenseStatusToLimits(zeroStatus);

    expect(result.members).toEqual({ current: 0, max: 0 });
    expect(result.messagesPerMonth).toEqual({ current: 0, max: 0 });
  });

  it("handles large values (unlimited)", () => {
    const unlimitedStatus = {
      currentMembers: 5,
      maxMembers: Infinity,
      currentMembersLite: 2,
      maxMembersLite: 5,
      currentTeams: 2,
      maxTeams: 5,
      currentProjects: 3,
      maxProjects: Number.MAX_SAFE_INTEGER,
      currentPrompts: 8,
      maxPrompts: 20,
      currentWorkflows: 4,
      maxWorkflows: 15,
      currentScenarios: 6,
      maxScenarios: 25,
      currentEvaluators: 3,
      maxEvaluators: 10,
      currentAgents: 7,
      maxAgents: 50,
      currentExperiments: 10,
      maxExperiments: 50,
      currentMessagesPerMonth: 1500,
      maxMessagesPerMonth: 10000,
      currentEvaluationsCredit: 50,
      maxEvaluationsCredit: 100,
    };

    const result = mapLicenseStatusToLimits(unlimitedStatus);

    expect(result.members.max).toBe(Infinity);
    expect(result.projects.max).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("mapUsageToLimits", () => {
  const baseUsage = {
    membersCount: 5,
    membersLiteCount: 2,
    teamsCount: 2,
    projectsCount: 3,
    promptsCount: 8,
    workflowsCount: 4,
    scenariosCount: 6,
    evaluatorsCount: 3,
    agentsCount: 7,
    experimentsCount: 10,
    currentMonthMessagesCount: 1500,
    evaluationsCreditUsed: 50,
  };

  const basePlan: PlanInfo = {
    type: "test-plan",
    name: "Test Plan",
    free: false,
    maxMembers: 10,
    maxMembersLite: 5,
    maxTeams: 5,
    maxProjects: 10,
    maxPrompts: 20,
    maxWorkflows: 15,
    maxScenarios: 25,
    maxEvaluators: 10,
    maxAgents: 50,
    maxExperiments: 50,
    maxOnlineEvaluations: 50,
    maxDatasets: 50,
    maxDashboards: 50,
    maxCustomGraphs: 100,
    maxAutomations: 50,
    maxMessagesPerMonth: 10000,
    evaluationsCredit: 100,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };

  it("maps usage data with plan limits to ResourceLimits format", () => {
    const result = mapUsageToLimits(baseUsage, basePlan);

    expect(result).toEqual({
      members: { current: 5, max: 10 },
      membersLite: { current: 2, max: 5 },
      teams: { current: 2, max: 5 },
      projects: { current: 3, max: 10 },
      prompts: { current: 8, max: 20 },
      workflows: { current: 4, max: 15 },
      scenarios: { current: 6, max: 25 },
      evaluators: { current: 3, max: 10 },
      agents: { current: 7, max: 50 },
      experiments: { current: 10, max: 50 },
      messagesPerMonth: { current: 1500, max: 10000 },
      evaluationsCredit: { current: 50, max: 100 },
    } satisfies ResourceLimits);
  });

  it("handles zero usage values correctly", () => {
    const zeroUsage = {
      membersCount: 0,
      membersLiteCount: 0,
      teamsCount: 0,
      projectsCount: 0,
      promptsCount: 0,
      workflowsCount: 0,
      scenariosCount: 0,
      evaluatorsCount: 0,
      agentsCount: 0,
      experimentsCount: 0,
      currentMonthMessagesCount: 0,
      evaluationsCreditUsed: 0,
    };

    const result = mapUsageToLimits(zeroUsage, basePlan);

    expect(result.members.current).toBe(0);
    expect(result.messagesPerMonth.current).toBe(0);
    expect(result.members.max).toBe(10);
  });

  it("handles free plan with limited resources", () => {
    const freePlan: PlanInfo = {
      type: "free",
      name: "Free",
      free: true,
      maxMembers: 1,
      maxMembersLite: 0,
      maxTeams: 1,
      maxProjects: 1,
      maxPrompts: 1,
      maxWorkflows: 1,
      maxScenarios: 1,
      maxEvaluators: 1,
      maxAgents: 3,
      maxExperiments: 3,
      maxOnlineEvaluations: 3,
      maxDatasets: 3,
      maxDashboards: 3,
      maxCustomGraphs: 3,
      maxAutomations: 3,
      maxMessagesPerMonth: 1000,
      evaluationsCredit: 10,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    };

    const result = mapUsageToLimits(baseUsage, freePlan);

    expect(result.members.max).toBe(1);
    expect(result.projects.max).toBe(1);
    expect(result.messagesPerMonth.max).toBe(1000);
    expect(result.evaluationsCredit.max).toBe(10);
  });

  it("handles unlimited plan values", () => {
    const unlimitedPlan: PlanInfo = {
      type: "test-plan",
      name: "Test Plan",
      free: false,
      maxMembers: Infinity,
      maxMembersLite: 5,
      maxTeams: 5,
      maxProjects: Number.MAX_SAFE_INTEGER,
      maxPrompts: 20,
      maxWorkflows: 15,
      maxScenarios: 25,
      maxEvaluators: 10,
      maxAgents: 50,
      maxExperiments: 50,
      maxOnlineEvaluations: 50,
      maxDatasets: 50,
      maxDashboards: 50,
      maxCustomGraphs: 100,
      maxAutomations: 50,
      maxMessagesPerMonth: 10000,
      evaluationsCredit: 100,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };

    const result = mapUsageToLimits(baseUsage, unlimitedPlan);

    expect(result.members.max).toBe(Infinity);
    expect(result.projects.max).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("correctly maps usage that exceeds plan limits", () => {
    const overLimitUsage = {
      membersCount: 15, // Exceeds max of 10
      membersLiteCount: 2,
      teamsCount: 2,
      projectsCount: 20, // Exceeds max of 10
      promptsCount: 8,
      workflowsCount: 4,
      scenariosCount: 6,
      evaluatorsCount: 3,
      agentsCount: 7,
      experimentsCount: 10,
      currentMonthMessagesCount: 1500,
      evaluationsCreditUsed: 50,
    };

    const result = mapUsageToLimits(overLimitUsage, basePlan);

    // Should preserve actual usage even if over limit
    expect(result.members.current).toBe(15);
    expect(result.members.max).toBe(10);
    expect(result.projects.current).toBe(20);
    expect(result.projects.max).toBe(10);
  });
});
