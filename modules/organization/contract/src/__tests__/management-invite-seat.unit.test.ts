import { describe, expect, it } from "vitest";

import { organizationManagementRestCreateInvitesSchema } from "../organization-management.rest.ts";

describe("organizationManagementRestCreateInvitesSchema", () => {
  /** @scenario The management API accepts the Developer seat */
  it("accepts a Developer invitation that names no team", () => {
    const parsed = organizationManagementRestCreateInvitesSchema.safeParse({
      invites: [{ email: "dev@example.com", role: "DEVELOPER" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("still requires a team for every other seat", () => {
    const parsed = organizationManagementRestCreateInvitesSchema.safeParse({
      invites: [{ email: "member@example.com", role: "MEMBER", teams: [] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["invites", 0, "teams"]);
  });
});
