import { describe, expect, it } from "vitest";
import { mapToPlanInfo } from "../planMapping";
import { DEFAULT_LIMIT, DEFAULT_MEMBERS_LITE } from "../constants";
import type { LicenseData } from "../types";

describe("mapToPlanInfo", () => {
  const createLicenseData = (
    planOverrides: Partial<LicenseData["plan"]> = {}
  ): LicenseData => ({
    licenseId: "lic-test-001",
    version: 1,
    organizationName: "Test Org",
    email: "test@example.com",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    plan: {
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxProjects: 99,
      maxMessagesPerMonth: 100_000,
      evaluationsCredit: 100,
      maxWorkflows: 50,
      maxPrompts: 50,
      maxEvaluators: 50,
      maxScenarios: 50,
      canPublish: true,
      ...planOverrides,
    },
  });

  it("maps license plan type and name correctly", () => {
    const licenseData = createLicenseData({
      type: "ENTERPRISE",
      name: "Enterprise Plan",
    });

    const result = mapToPlanInfo(licenseData);

    expect(result.type).toBe("ENTERPRISE");
    expect(result.name).toBe("Enterprise Plan");
  });

  it("maps all numeric limits correctly", () => {
    const licenseData = createLicenseData({
      maxMembers: 5,
      maxProjects: 10,
      maxMessagesPerMonth: 50000,
      evaluationsCredit: 100,
      maxWorkflows: 25,
      maxPrompts: 30,
      maxEvaluators: 35,
      maxScenarios: 40,
    });

    const result = mapToPlanInfo(licenseData);

    expect(result.maxMembers).toBe(5);
    expect(result.maxProjects).toBe(10);
    expect(result.maxMessagesPerMonth).toBe(50000);
    expect(result.evaluationsCredit).toBe(100);
    expect(result.maxWorkflows).toBe(25);
    expect(result.maxPrompts).toBe(30);
    expect(result.maxEvaluators).toBe(35);
    expect(result.maxScenarios).toBe(40);
  });

  it("maps canPublish flag correctly when true", () => {
    const licenseData = createLicenseData({ canPublish: true });

    const result = mapToPlanInfo(licenseData);

    expect(result.canPublish).toBe(true);
  });

  it("maps canPublish flag correctly when false", () => {
    const licenseData = createLicenseData({ canPublish: false });

    const result = mapToPlanInfo(licenseData);

    expect(result.canPublish).toBe(false);
  });

  it("sets free flag to false for licensed plans", () => {
    const licenseData = createLicenseData();

    const result = mapToPlanInfo(licenseData);

    expect(result.free).toBe(false);
  });

  it("sets overrideAddingLimitations to false", () => {
    const licenseData = createLicenseData();

    const result = mapToPlanInfo(licenseData);

    expect(result.overrideAddingLimitations).toBe(false);
  });

  it("sets prices to zero for self-hosted", () => {
    const licenseData = createLicenseData();

    const result = mapToPlanInfo(licenseData);

    expect(result.prices).toEqual({ USD: 0, EUR: 0 });
  });

  it("maps maxMembersLite when provided", () => {
    const licenseData = createLicenseData({ maxMembersLite: 10 });

    const result = mapToPlanInfo(licenseData);

    expect(result.maxMembersLite).toBe(10);
  });

  it("defaults maxMembersLite to 1 when not provided", () => {
    const licenseData = createLicenseData();

    const result = mapToPlanInfo(licenseData);

    expect(result.maxMembersLite).toBe(DEFAULT_MEMBERS_LITE);
  });

  it("uses DEFAULT_LIMIT for optional fields not in older licenses", () => {
    // Simulate an older license that doesn't have the new optional fields
    const oldLicenseData: LicenseData = {
      licenseId: "lic-old-001",
      version: 1,
      organizationName: "Legacy Org",
      email: "legacy@example.com",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      plan: {
        type: "PRO",
        name: "Pro",
        maxMembers: 10,
        maxProjects: 99,
        maxMessagesPerMonth: 100_000,
        evaluationsCredit: 100,
        maxWorkflows: 50,
        canPublish: true,
        // Note: maxPrompts, maxEvaluators, maxScenarios, maxMembersLite are NOT provided
      },
    };

    const result = mapToPlanInfo(oldLicenseData);

    // Should use DEFAULT_LIMIT for missing optional fields
    expect(result.maxPrompts).toBe(DEFAULT_LIMIT);
    expect(result.maxEvaluators).toBe(DEFAULT_LIMIT);
    expect(result.maxScenarios).toBe(DEFAULT_LIMIT);
    expect(result.maxMembersLite).toBe(DEFAULT_MEMBERS_LITE);
  });

  it("maps usageUnit from license data", () => {
    const licenseData = createLicenseData({ usageUnit: "events" });

    const result = mapToPlanInfo(licenseData);

    expect(result.usageUnit).toBe("events");
  });

  it("defaults usageUnit to traces for legacy licenses", () => {
    const oldLicenseData: LicenseData = {
      licenseId: "lic-old-002",
      version: 1,
      organizationName: "Legacy Org",
      email: "legacy@example.com",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      plan: {
        type: "PRO",
        name: "Pro",
        maxMembers: 10,
        maxProjects: 99,
        maxMessagesPerMonth: 100_000,
        evaluationsCredit: 100,
        maxWorkflows: 50,
        canPublish: true,
      },
    };

    const result = mapToPlanInfo(oldLicenseData);

    expect(result.usageUnit).toBe("traces");
  });

  it("uses DEFAULT_LIMIT which is JSON-serializable", () => {
    // Ensure DEFAULT_LIMIT can be serialized (not Infinity)
    const serialized = JSON.stringify({ limit: DEFAULT_LIMIT });
    const parsed = JSON.parse(serialized);

    expect(parsed.limit).toBe(DEFAULT_LIMIT);
    expect(Number.isFinite(DEFAULT_LIMIT)).toBe(true);
  });
});
