import { licenseSeatsShape } from "@langwatch/plans";
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

  /** @scenario The mint script states Developer seats */
  it("reads the Developer seats", () => {
    expect(
      parseGenerateLicenseArgs(["--org-id", "o", "--max-members-developer", "2"]),
    ).toMatchObject({ maxMembersDeveloper: 2 });
  });

  /** @scenario Every seat kind a licence sells is accepted by every issue path */
  it.each(Object.keys(licenseSeatsShape))("takes a flag for the %s a licence sells", (seat) => {
    const flag = `--${seat.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

    expect(parseGenerateLicenseArgs(["--org-id", "o", flag, "3"])).toMatchObject({ [seat]: 3 });
  });

  it("refuses a recognised flag given no value, rather than dropping it", () => {
    expect(() => parseGenerateLicenseArgs(["--org-id", "o", "--max-members-developer"])).toThrow(
      "--max-members-developer requires a value",
    );
  });

  it.each(["--max-members", "--max-members-lite", "--max-members-developer"])(
    "refuses %s above the seat column's maximum, naming the flag",
    (flag) => {
      expect(() => parseGenerateLicenseArgs(["--org-id", "o", flag, "2147483648"])).toThrow(
        `${flag} can be at most 2147483647`,
      );
    },
  );
});
