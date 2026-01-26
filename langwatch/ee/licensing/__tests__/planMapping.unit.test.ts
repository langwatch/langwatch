import { describe, expect, it } from "vitest";
import { mapToPlanInfo } from "../planMapping";
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
    });

    const result = mapToPlanInfo(licenseData);

    expect(result.maxMembers).toBe(5);
    expect(result.maxProjects).toBe(10);
    expect(result.maxMessagesPerMonth).toBe(50000);
    expect(result.evaluationsCredit).toBe(100);
    expect(result.maxWorkflows).toBe(25);
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
});
