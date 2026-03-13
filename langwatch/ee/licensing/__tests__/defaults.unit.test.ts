import { describe, expect, it } from "vitest";
import {
  resolvePlanDefaults,
  type ResolvedPlanLimits,
} from "../defaults";
import { DEFAULT_LIMIT, DEFAULT_MEMBERS_LITE } from "../constants";
import type { LicensePlanLimits } from "../types";

/**
 * Tests for resolvePlanDefaults function.
 * Verifies that optional fields in LicensePlanLimits receive correct defaults.
 */

describe("resolvePlanDefaults", () => {
  it("applies defaults to all optional fields when not provided", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxProjects: 50,
      maxMessagesPerMonth: 1_000_000,
      evaluationsCredit: 10_000,
      maxWorkflows: 200,
      canPublish: true,
      // Optional fields omitted: maxMembersLite, maxPrompts, maxEvaluators, maxScenarios
    };

    const resolved = resolvePlanDefaults(plan);

    // Required fields pass through unchanged
    expect(resolved.type).toBe("ENTERPRISE");
    expect(resolved.name).toBe("Enterprise");
    expect(resolved.maxMembers).toBe(100);
    expect(resolved.maxProjects).toBe(50);
    expect(resolved.maxMessagesPerMonth).toBe(1_000_000);
    expect(resolved.evaluationsCredit).toBe(10_000);
    expect(resolved.maxWorkflows).toBe(200);
    expect(resolved.canPublish).toBe(true);

    // Optional fields receive defaults
    expect(resolved.maxMembersLite).toBe(DEFAULT_MEMBERS_LITE);
    expect(resolved.maxPrompts).toBe(DEFAULT_LIMIT);
    expect(resolved.maxEvaluators).toBe(DEFAULT_LIMIT);
    expect(resolved.maxScenarios).toBe(DEFAULT_LIMIT);
    expect(resolved.maxAgents).toBe(DEFAULT_LIMIT);
    expect(resolved.maxOnlineEvaluations).toBe(DEFAULT_LIMIT);
    expect(resolved.usageUnit).toBe("traces");
  });

  it("defaults usageUnit to traces when not provided", () => {
    const plan: LicensePlanLimits = {
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxProjects: 20,
      maxMessagesPerMonth: 100_000,
      evaluationsCredit: 500,
      maxWorkflows: 50,
      canPublish: true,
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("traces");
  });

  it("preserves explicit usageUnit events value", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxProjects: 50,
      maxMessagesPerMonth: 1_000_000,
      evaluationsCredit: 10_000,
      maxWorkflows: 200,
      canPublish: true,
      usageUnit: "events",
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("events");
  });

  it("normalizes unknown usageUnit values to traces", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxProjects: 50,
      maxMessagesPerMonth: 1_000_000,
      evaluationsCredit: 10_000,
      maxWorkflows: 200,
      canPublish: true,
      usageUnit: "spans",
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("traces");
  });

  it("preserves explicitly set optional fields", () => {
    const plan: LicensePlanLimits = {
      type: "TEAM",
      name: "Team",
      maxMembers: 10,
      maxMembersLite: 5,
      maxProjects: 10,
      maxMessagesPerMonth: 100_000,
      evaluationsCredit: 1_000,
      maxWorkflows: 50,
      maxPrompts: 25,
      maxEvaluators: 30,
      maxScenarios: 20,
      maxAgents: 15,
      canPublish: true,
    };

    const resolved = resolvePlanDefaults(plan);

    // All fields preserved from input
    expect(resolved.maxMembersLite).toBe(5);
    expect(resolved.maxPrompts).toBe(25);
    expect(resolved.maxEvaluators).toBe(30);
    expect(resolved.maxScenarios).toBe(20);
    expect(resolved.maxAgents).toBe(15);
  });

  it("handles partial optional fields (some set, some not)", () => {
    const plan: LicensePlanLimits = {
      type: "STARTER",
      name: "Starter",
      maxMembers: 5,
      maxMembersLite: 3, // Set
      maxProjects: 5,
      maxMessagesPerMonth: 50_000,
      evaluationsCredit: 500,
      maxWorkflows: 20,
      maxPrompts: 10, // Set
      // maxEvaluators: omitted
      // maxScenarios: omitted
      // maxAgents: omitted
      canPublish: false,
    };

    const resolved = resolvePlanDefaults(plan);

    // Explicitly set values preserved
    expect(resolved.maxMembersLite).toBe(3);
    expect(resolved.maxPrompts).toBe(10);

    // Omitted values get defaults
    expect(resolved.maxEvaluators).toBe(DEFAULT_LIMIT);
    expect(resolved.maxScenarios).toBe(DEFAULT_LIMIT);
    expect(resolved.maxAgents).toBe(DEFAULT_LIMIT);
  });

  it("returns a type-safe ResolvedPlanLimits with all fields required", () => {
    const plan: LicensePlanLimits = {
      type: "TEST",
      name: "Test",
      maxMembers: 1,
      maxProjects: 1,
      maxMessagesPerMonth: 1000,
      evaluationsCredit: 100,
      maxWorkflows: 10,
      canPublish: false,
    };

    const resolved: ResolvedPlanLimits = resolvePlanDefaults(plan);

    // TypeScript enforces all these fields exist (no optional marker)
    // If any field were missing, this would be a compile error
    const allFields: ResolvedPlanLimits = {
      type: resolved.type,
      name: resolved.name,
      maxMembers: resolved.maxMembers,
      maxMembersLite: resolved.maxMembersLite,
      maxTeams: resolved.maxTeams,
      maxProjects: resolved.maxProjects,
      maxMessagesPerMonth: resolved.maxMessagesPerMonth,
      evaluationsCredit: resolved.evaluationsCredit,
      maxWorkflows: resolved.maxWorkflows,
      maxPrompts: resolved.maxPrompts,
      maxEvaluators: resolved.maxEvaluators,
      maxScenarios: resolved.maxScenarios,
      maxAgents: resolved.maxAgents,
      maxExperiments: resolved.maxExperiments,
      maxOnlineEvaluations: resolved.maxOnlineEvaluations,
      maxDatasets: resolved.maxDatasets,
      maxDashboards: resolved.maxDashboards,
      maxCustomGraphs: resolved.maxCustomGraphs,
      maxAutomations: resolved.maxAutomations,
      canPublish: resolved.canPublish,
      usageUnit: resolved.usageUnit,
    };

    expect(allFields).toEqual(resolved);
  });
});
