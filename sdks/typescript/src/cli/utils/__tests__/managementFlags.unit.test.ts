/**
 * The flag grammar the management commands share: what each colon-separated
 * shape parses into, and what a malformed value is refused with.
 *
 * Parsed directly rather than through a command, because these are the pieces
 * every family reuses and a refusal must name the expected shape wherever it
 * is hit.
 *
 * @see specs/typescript-sdk/cli-management-apis.feature
 */
import { describe, expect, it } from "vitest";
import {
  composeInvitesFromFlags,
  composeRoleBindingFilters,
  composeRoleBindingPrincipal,
  ManagementFlagError,
  parseBindingFlags,
  parseCount,
  parseInvitesJson,
  parseOrganizationRole,
  parsePermissionFlags,
  parsePermissionMode,
  parseRole,
  parseScopeType,
} from "../managementFlags";

describe("parsePermissionFlags", () => {
  describe("when the permission flag is repeated", () => {
    /** @scenario Repeated permission flags compose into one permission set */
    it("composes the pairs into one set, in the order given, and names the shape it expects", () => {
      expect(
        parsePermissionFlags(["project:view", "trace:manage", "dataset:create"]),
      ).toEqual(["project:view", "trace:manage", "dataset:create"]);

      // The same pair twice is one permission, not two.
      expect(parsePermissionFlags(["project:view", "project:view"])).toEqual([
        "project:view",
      ]);

      // A value that is not a resource and action pair is refused by NAMING the
      // shape: "invalid" alone leaves the caller guessing.
      for (const malformed of ["project", "project:", ":view", "a:b:c"]) {
        expect(() => parsePermissionFlags([malformed])).toThrow(
          ManagementFlagError,
        );
        expect(() => parsePermissionFlags([malformed])).toThrow(
          /Expected resource:action/,
        );
      }
    });
  });
});

describe("parseBindingFlags", () => {
  describe("when a binding flag is parsed", () => {
    /** @scenario A binding flag parses role, scope type and scope id */
    it("reads the role, the scope type and the scope id out of it, and names the shape it expects", () => {
      expect(parseBindingFlags(["ADMIN:PROJECT:project_abc"])).toEqual([
        { role: "ADMIN", scopeType: "PROJECT", scopeId: "project_abc" },
      ]);

      // Repeated, and case-insensitive on the two enumerations.
      expect(
        parseBindingFlags(["viewer:team:team_1", "CUSTOM:ORGANIZATION:org_1"]),
      ).toEqual([
        { role: "VIEWER", scopeType: "TEAM", scopeId: "team_1" },
        { role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: "org_1" },
      ]);

      expect(() => parseBindingFlags(["ADMIN:PROJECT"])).toThrow(
        /Expected role:scopeType:scopeId/,
      );
      expect(() => parseBindingFlags(["ADMIN::project_abc"])).toThrow(
        /Expected role:scopeType:scopeId/,
      );
      // The right shape with a wrong word says which words are allowed.
      expect(() => parseBindingFlags(["OWNER:PROJECT:project_abc"])).toThrow(
        /Expected one of ADMIN, MEMBER, VIEWER, CUSTOM/,
      );
      expect(() => parseBindingFlags(["ADMIN:WORKSPACE:project_abc"])).toThrow(
        /Expected one of ORGANIZATION, TEAM, PROJECT/,
      );
    });
  });
});

describe("composeRoleBindingFilters", () => {
  describe("given a principal type, a principal id and a scope", () => {
    it("maps the principal type onto the request field it names", () => {
      expect(
        composeRoleBindingFilters({
          principalType: "user",
          principalId: "user_1",
        }),
      ).toEqual({ userId: "user_1" });
      expect(
        composeRoleBindingFilters({
          principalType: "group",
          principalId: "group_1",
        }),
      ).toEqual({ groupId: "group_1" });
      expect(
        composeRoleBindingFilters({
          principalType: "api-key",
          principalId: "key_1",
        }),
      ).toEqual({ apiKeyId: "key_1" });
    });

    it("refuses a principal id with no principal type to say what it names", () => {
      expect(() =>
        composeRoleBindingFilters({ principalId: "user_1" }),
      ).toThrow(/--principal-type/);
    });

    it("refuses a principal type with no principal id to name", () => {
      // Dropping the half pair would list every binding in the organization,
      // which is the opposite of what the caller asked for.
      expect(() =>
        composeRoleBindingFilters({ principalType: "user" }),
      ).toThrow(/--principal-id/);
    });
  });

  describe("when no filter is given", () => {
    it("sends nothing rather than empty filters", () => {
      expect(composeRoleBindingFilters({})).toEqual({});
    });
  });
});

describe("composeRoleBindingPrincipal", () => {
  it("names exactly one principal field", () => {
    expect(
      composeRoleBindingPrincipal({
        principalType: "api-key",
        principalId: "key_1",
      }),
    ).toEqual({ apiKeyId: "key_1" });
    expect(() =>
      composeRoleBindingPrincipal({
        principalType: "robot",
        principalId: "x",
      }),
    ).toThrow(/Expected one of user, group, api-key/);
  });
});

describe("composeInvitesFromFlags", () => {
  it("applies one role to the whole batch and the teams to every invite", () => {
    expect(
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com"],
        role: ["MEMBER"],
        team: ["team_1:MEMBER", "team_2:VIEWER"],
      }),
    ).toEqual([
      {
        email: "a@example.com",
        role: "MEMBER",
        teams: [
          { teamId: "team_1", role: "MEMBER" },
          { teamId: "team_2", role: "VIEWER" },
        ],
      },
      {
        email: "b@example.com",
        role: "MEMBER",
        teams: [
          { teamId: "team_1", role: "MEMBER" },
          { teamId: "team_2", role: "VIEWER" },
        ],
      },
    ]);
  });

  it("pairs roles with emails one for one when several are given", () => {
    expect(
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com"],
        role: ["ADMIN", "MEMBER"],
        team: ["team_1:MEMBER"],
      }).map((invite) => invite.role),
    ).toEqual(["ADMIN", "MEMBER"]);
  });

  it("refuses a role count that lines up with nothing", () => {
    expect(() =>
      composeInvitesFromFlags({
        email: ["a@example.com", "b@example.com", "c@example.com"],
        role: ["ADMIN", "MEMBER"],
        team: ["team_1:MEMBER"],
      }),
    ).toThrow(/one --role for the whole batch, or one per --email/);
  });

  it("refuses a batch with no team to land on", () => {
    expect(() =>
      composeInvitesFromFlags({ email: ["a@example.com"], role: ["MEMBER"] }),
    ).toThrow(/--team teamId:role/);
  });

  it("refuses a malformed team assignment by naming the shape", () => {
    expect(() =>
      composeInvitesFromFlags({
        email: ["a@example.com"],
        role: ["MEMBER"],
        team: ["team_1"],
      }),
    ).toThrow(/Expected teamId:role/);
  });
});

describe("parseInvitesJson", () => {
  const batch = [
    {
      email: "a@example.com",
      role: "MEMBER",
      teams: [{ teamId: "team_1", role: "MEMBER", customRoleId: "role_1" }],
    },
  ];

  it("accepts a bare array and the invites envelope the API answers with", () => {
    expect(parseInvitesJson(JSON.stringify(batch))).toEqual(batch);
    expect(parseInvitesJson(JSON.stringify({ invites: batch }))).toEqual(batch);
  });

  it("refuses a document that is not an invite batch", () => {
    expect(() => parseInvitesJson("{oops")).toThrow(/Invalid JSON/);
    expect(() => parseInvitesJson('"nope"')).toThrow(/expected a JSON array/);
    expect(() => parseInvitesJson("[]")).toThrow(/empty/);
    expect(() => parseInvitesJson('[{"role":"MEMBER"}]')).toThrow(/no email/);
    expect(() => parseInvitesJson('[{"email":"a@b.c"}]')).toThrow(/no role/);
    expect(() =>
      parseInvitesJson('[{"email":"a@b.c","role":"MEMBER"}]'),
    ).toThrow(/no teams/);
  });

  it("refuses a custom role id that is not a role id", () => {
    const withCustomRoleId = (customRoleId: unknown): string =>
      JSON.stringify([
        {
          email: "a@example.com",
          role: "MEMBER",
          teams: [{ teamId: "team_1", role: "CUSTOM", customRoleId }],
        },
      ]);

    for (const malformed of [42, {}, [], "", "   "]) {
      expect(() => parseInvitesJson(withCustomRoleId(malformed))).toThrow(
        ManagementFlagError,
      );
      expect(() => parseInvitesJson(withCustomRoleId(malformed))).toThrow(
        /customRoleId that is not a role id/,
      );
    }
  });
});

describe("the single-value parsers", () => {
  it("reads a whole number and refuses anything a page size cannot be", () => {
    expect(parseCount("0", "--page")).toBe(0);
    expect(parseCount("50", "--limit")).toBe(50);

    // "" and " " coerce to 0 through Number, and "0x10" and "1e3" coerce to
    // numbers nobody typed: all of them are refused by name.
    for (const malformed of ["", "   ", "-1", "1.5", "abc", "0x10", "1e3"]) {
      expect(() => parseCount(malformed, "--limit")).toThrow(
        ManagementFlagError,
      );
      expect(() => parseCount(malformed, "--limit")).toThrow(/--limit/);
    }
  });

  it("normalise the enumerations and name what they expect", () => {
    expect(parseRole("admin")).toBe("ADMIN");
    expect(parseScopeType("project")).toBe("PROJECT");
    expect(parseOrganizationRole("external")).toBe("EXTERNAL");
    expect(parsePermissionMode("Restricted")).toBe("restricted");

    expect(() => parseRole("owner")).toThrow(/Expected one of ADMIN/);
    expect(() => parseScopeType("workspace")).toThrow(/Expected one of ORGANIZATION/);
    // VIEWER is a binding role, not an organization role: the two vocabularies
    // are different and the refusal says so.
    expect(() => parseOrganizationRole("VIEWER")).toThrow(
      /Expected one of ADMIN, MEMBER, EXTERNAL/,
    );
    expect(() => parsePermissionMode("none")).toThrow(
      /Expected one of all, readonly, restricted/,
    );
  });
});
