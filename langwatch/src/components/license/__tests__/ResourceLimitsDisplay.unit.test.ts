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
    currentMessagesPerMonth: 1500,
    maxMessagesPerMonth: 10000,
  };

  it("maps all license status fields to ResourceLimits format", () => {
    const result = mapLicenseStatusToLimits(baseLicenseStatus);

    expect(result).toEqual({
      members: { current: 5, max: 10 },
      membersLite: { current: 2, max: 5 },
      teams: { current: 2, max: 5 },
      projects: { current: 3, max: 10 },
      messagesPerMonth: { current: 1500, max: 10000 },
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
      currentMessagesPerMonth: 0,
      maxMessagesPerMonth: 0,
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
      currentMessagesPerMonth: 1500,
      maxMessagesPerMonth: 10000,
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
    currentMonthMessagesCount: 1500,
  };

  const basePlan: PlanInfo = {
    planSource: "subscription",
    type: "test-plan",
    name: "Test Plan",
    free: false,
    maxMembers: 10,
    maxMembersLite: 5,
    maxTeams: 5,
    maxProjects: 10,
    maxMessagesPerMonth: 10000,
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
      messagesPerMonth: { current: 1500, max: 10000 },
    } satisfies ResourceLimits);
  });

  it("handles zero usage values correctly", () => {
    const zeroUsage = {
      membersCount: 0,
      membersLiteCount: 0,
      teamsCount: 0,
      projectsCount: 0,
      currentMonthMessagesCount: 0,
    };

    const result = mapUsageToLimits(zeroUsage, basePlan);

    expect(result.members.current).toBe(0);
    expect(result.messagesPerMonth.current).toBe(0);
    expect(result.members.max).toBe(10);
  });

  it("handles free plan with limited resources", () => {
    const freePlan: PlanInfo = {
      planSource: "free",
      type: "free",
      name: "Free",
      free: true,
      maxMembers: 1,
      maxMembersLite: 0,
      maxTeams: 1,
      maxProjects: 2,
      maxMessagesPerMonth: 1000,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    };

    const result = mapUsageToLimits(baseUsage, freePlan);

    expect(result.members.max).toBe(1);
    expect(result.projects.max).toBe(2);
    expect(result.messagesPerMonth.max).toBe(1000);
  });

  it("handles unlimited plan values", () => {
    const unlimitedPlan: PlanInfo = {
      planSource: "subscription",
      type: "test-plan",
      name: "Test Plan",
      free: false,
      maxMembers: Infinity,
      maxMembersLite: 5,
      maxTeams: 5,
      maxProjects: Number.MAX_SAFE_INTEGER,
      maxMessagesPerMonth: 10000,
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
      currentMonthMessagesCount: 1500,
    };

    const result = mapUsageToLimits(overLimitUsage, basePlan);

    // Should preserve actual usage even if over limit
    expect(result.members.current).toBe(15);
    expect(result.members.max).toBe(10);
    expect(result.projects.current).toBe(20);
    expect(result.projects.max).toBe(10);
  });
});
