import { describe, expect, it } from "vitest";
import {
  resolvePlanDefaults,
  type ResolvedPlanLimits,
} from "../defaults";
import { DEFAULT_MEMBERS_LITE } from "../constants";
import type { LicensePlanLimits } from "../types";

/**
 * Tests for resolvePlanDefaults.
 *
 * Only the enforced levers (member seats, messages volume) + plan identity are
 * resolved onto the active plan. Workspace structure (projects, teams) and
 * experimentation resources are OSS/uncapped, so their license fields — even
 * when present in an older signed payload — are ignored and never resolved.
 */

describe("resolvePlanDefaults", () => {
  it("passes through identity, seats, messages, and canPublish", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxMembersLite: 50,
      maxMessagesPerMonth: 1_000_000,
      canPublish: true,
      usageUnit: "events",
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.type).toBe("ENTERPRISE");
    expect(resolved.name).toBe("Enterprise");
    expect(resolved.maxMembers).toBe(100);
    expect(resolved.maxMembersLite).toBe(50);
    expect(resolved.maxMessagesPerMonth).toBe(1_000_000);
    expect(resolved.canPublish).toBe(true);
    expect(resolved.usageUnit).toBe("events");
  });

  it("defaults maxMembersLite when not provided", () => {
    const plan: LicensePlanLimits = {
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxMessagesPerMonth: 100_000,
      canPublish: true,
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.maxMembersLite).toBe(DEFAULT_MEMBERS_LITE);
  });

  it("preserves an explicit maxMembersLite", () => {
    const plan: LicensePlanLimits = {
      type: "TEAM",
      name: "Team",
      maxMembers: 10,
      maxMembersLite: 5,
      maxMessagesPerMonth: 100_000,
      canPublish: true,
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.maxMembersLite).toBe(5);
  });

  it("defaults usageUnit to traces when not provided", () => {
    const plan: LicensePlanLimits = {
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxMessagesPerMonth: 100_000,
      canPublish: true,
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("traces");
  });

  it("preserves an explicit usageUnit of events", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxMessagesPerMonth: 1_000_000,
      canPublish: true,
      usageUnit: "events",
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("events");
  });

  it("normalizes an unknown usageUnit to traces", () => {
    const plan: LicensePlanLimits = {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxMessagesPerMonth: 1_000_000,
      canPublish: true,
      usageUnit: "spans",
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved.usageUnit).toBe("traces");
  });

  it("ignores workspace-structure and experimentation caps in the payload", () => {
    // An older license that still encodes these caps must resolve cleanly,
    // surfacing only the enforced levers.
    const plan: LicensePlanLimits = {
      type: "LEGACY",
      name: "Legacy",
      maxMembers: 10,
      maxMembersLite: 3,
      maxMessagesPerMonth: 50_000,
      maxProjects: 5,
      maxTeams: 2,
      maxWorkflows: 20,
      maxPrompts: 10,
      canPublish: false,
    };

    const resolved = resolvePlanDefaults(plan);

    expect(resolved).toEqual({
      type: "LEGACY",
      name: "Legacy",
      maxMembers: 10,
      maxMembersLite: 3,
      maxMessagesPerMonth: 50_000,
      canPublish: false,
      usageUnit: "traces",
    });
    expect("maxProjects" in resolved).toBe(false);
    expect("maxWorkflows" in resolved).toBe(false);
  });

  it("returns a ResolvedPlanLimits with exactly the enforced fields", () => {
    const plan: LicensePlanLimits = {
      type: "TEST",
      name: "Test",
      maxMembers: 1,
      maxMessagesPerMonth: 1000,
      canPublish: false,
    };

    const resolved: ResolvedPlanLimits = resolvePlanDefaults(plan);

    // TypeScript enforces these are exactly the fields on ResolvedPlanLimits.
    const allFields: ResolvedPlanLimits = {
      type: resolved.type,
      name: resolved.name,
      maxMembers: resolved.maxMembers,
      maxMembersLite: resolved.maxMembersLite,
      maxMessagesPerMonth: resolved.maxMessagesPerMonth,
      canPublish: resolved.canPublish,
      usageUnit: resolved.usageUnit,
    };

    expect(allFields).toEqual(resolved);
  });
});
