import { describe, expect, it } from "vitest";

import { parseGenerateLicenseArgs } from "../generate-license-args.rules.ts";

describe("parseGenerateLicenseArgs", () => {
  it("reads main's flags, upper-casing the plan", () => {
    const { expiresAt, ...request } = parseGenerateLicenseArgs([
      "--org-id",
      "org-acme",
      "--plan",
      "growth",
      "--max-members",
      "12",
      "--expires-at",
      "2030-02-05",
      "--email",
      "ops@example.com",
    ]);

    expect(request).toEqual({
      organizationId: "org-acme",
      planType: "GROWTH",
      maxMembers: 12,
      email: "ops@example.com",
    });
    expect(expiresAt?.toString()).toBe("2030-02-05T00:00:00Z");
  });

  it("defaults the plan to ENTERPRISE", () => {
    expect(parseGenerateLicenseArgs(["--org-id", "org-acme"])).toEqual({
      organizationId: "org-acme",
      planType: "ENTERPRISE",
    });
  });

  it("refuses a run with no organization", () => {
    expect(() => parseGenerateLicenseArgs(["--plan", "PRO"])).toThrow("--org-id is required");
  });

  it("refuses a quota that is not a whole number", () => {
    expect(() => parseGenerateLicenseArgs(["--org-id", "o", "--max-members", "50GB"])).toThrow(
      "--max-members must be a whole number",
    );
  });

  it("refuses a calendar date that does not exist", () => {
    expect(() => parseGenerateLicenseArgs(["--org-id", "o", "--expires-at", "2025-02-31"])).toThrow(
      "--expires-at must be a calendar date",
    );
  });
});
