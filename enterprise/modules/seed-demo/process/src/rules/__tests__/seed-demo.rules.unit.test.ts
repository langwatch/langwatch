// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { assertDemoOrgAllowed, parseDemoOrgIds } from "../demo-org-scope.rules.ts";
import { verifyOrgIdentity } from "../org-identity.rules.ts";
import { parseSeedDemoArgs } from "../seed-demo-args.rules.ts";

describe("demo organization scope", () => {
  /** @scenario "An unset allowlist refuses the run by name" */
  it("refuses an unset or blank allowlist, naming DEMO_ORG_IDS", () => {
    expect(() => parseDemoOrgIds(undefined)).toThrow(/DEMO_ORG_IDS is not set/);
    expect(() => parseDemoOrgIds("  ")).toThrow(/DEMO_ORG_IDS is not set/);
  });

  /** @scenario "A malformed allowlist entry is refused" */
  it("refuses a malformed id", () => {
    expect(() => parseDemoOrgIds("organization_one,bad id")).toThrow(/"bad id"/);
  });

  it("trims and deduplicates the allowlist", () => {
    expect(parseDemoOrgIds(" organization_one, organization_one ,organization_two")).toEqual([
      "organization_one",
      "organization_two",
    ]);
  });

  /** @scenario "An organization outside the allowlist is refused" */
  it("refuses an organization outside the allowlist", () => {
    expect(() => assertDemoOrgAllowed("customer_org", ["organization_one"])).toThrow(
      /not in the demo allowlist/,
    );
  });
});

describe("verifyOrgIdentity", () => {
  /** @scenario "A demo organization missing its slug fails the identity check" */
  it("fails an organization without a slug", () => {
    const outcome = verifyOrgIdentity({ id: "organization_one", name: "Demo", slug: "" });
    expect(outcome).toEqual({
      status: "failed",
      error: "Demo org organization_one is missing required identity fields: slug",
    });
  });

  it("succeeds with a name and a slug", () => {
    expect(verifyOrgIdentity({ id: "organization_one", name: "Demo", slug: "demo" }).status).toBe(
      "succeeded",
    );
  });
});

describe("parseSeedDemoArgs", () => {
  it("is a dry run unless --execute", () => {
    expect(parseSeedDemoArgs([])).toEqual({ execute: false });
    expect(parseSeedDemoArgs(["--execute", "--org-id", "organization_two"])).toEqual({
      execute: true,
      organizationId: "organization_two",
    });
  });

  /** @scenario "The seed task refuses an argument it does not know" */
  it("refuses an unknown flag by name", () => {
    expect(() => parseSeedDemoArgs(["--report-path", "/tmp/run.txt"])).toThrow(
      'unknown argument "--report-path"',
    );
  });
});
