/**
 * Folding role assignments onto whoever holds them.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { describe, expect, it } from "vitest";
import type { AssignmentRow } from "../roleHolders";
import {
  holdersOf,
  peopleHoldingCustomRole,
  peopleHoldingRole,
  scopeCounts,
  scopesOfCustomRole,
  summariseScopes,
} from "../roleHolders";

function assignment(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: "rb_1",
    userId: "user_sam",
    userName: "Sam Rivera",
    userEmail: "sam@acme.com",
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "ADMIN",
    customRoleId: null,
    customRoleName: null,
    scopeType: "TEAM",
    scopeId: "team_1",
    scopeName: "Platform",
    memberUserIds: [],
    ...overrides,
  };
}

describe("given assignments that name no user and no group", () => {
  describe("when they are folded onto their holders", () => {
    /** @scenario Every holder is named, whatever kind of holder it is */
    it("keeps each API key its own row", () => {
      const holders = holdersOf([
        assignment({
          id: "a",
          userId: null,
          apiKeyId: "k1",
          apiKeyName: "One",
        }),
        assignment({
          id: "b",
          userId: null,
          apiKeyId: "k2",
          apiKeyName: "Two",
        }),
      ]);

      expect(holders.map((holder) => holder.name)).toEqual(["One", "Two"]);
      expect(new Set(holders.map((holder) => holder.key)).size).toBe(2);
    });

    /** @scenario Every holder is named, whatever kind of holder it is */
    it("keeps an assignment with no holder at all countable", () => {
      const holders = holdersOf([
        assignment({ id: "a", userId: null }),
        assignment({ id: "b", userId: null }),
      ]);

      expect(holders).toHaveLength(2);
      for (const holder of holders) {
        expect(holder.name).toBe("An assignment with no holder");
      }
    });

    /** @scenario Every holder is named, whatever kind of holder it is */
    it("falls back to the address, then to a sentence", () => {
      const [byAddress] = holdersOf([assignment({ userName: null })]);
      const [byNothing] = holdersOf([
        assignment({ userName: null, userEmail: null }),
      ]);

      expect(byAddress?.name).toBe("sam@acme.com");
      expect(byNothing?.name).toBe("A member with no name yet");
    });
  });
});

describe("given one person holding one role in many places", () => {
  const rows = [
    assignment({
      id: "a",
      scopeType: "ORGANIZATION",
      scopeId: "org",
      scopeName: "Acme",
    }),
    assignment({ id: "b", scopeId: "team_1", scopeName: "Platform" }),
    assignment({ id: "c", scopeId: "team_2", scopeName: "Support" }),
  ];

  describe("when they are folded", () => {
    /** @scenario Identical grants are summarised rather than repeated */
    it("collapses to one row carrying one role", () => {
      const holders = holdersOf(rows);

      expect(holders).toHaveLength(1);
      expect(holders[0]?.grants).toHaveLength(1);
      expect(holders[0]?.grants[0]?.scopes).toHaveLength(3);
      expect(holders[0]?.assignmentCount).toBe(3);
    });

    /** @scenario Identical grants are summarised rather than repeated */
    it("counts the kinds of scope rather than naming them all", () => {
      const scopes = holdersOf(rows)[0]?.grants[0]?.scopes ?? [];

      expect(summariseScopes(scopes)).toBe("Organization, and 2 teams");
    });
  });
});

describe("given a role held through a group", () => {
  const rows = [
    assignment({
      id: "grp",
      userId: null,
      userName: null,
      userEmail: null,
      groupId: "g1",
      groupName: "Support",
      memberUserIds: ["user_a", "user_b"],
    }),
    assignment({ id: "direct", userId: "user_b" }),
  ];

  describe("when the people holding it are counted", () => {
    /** @scenario A predefined role card describes the role it actually is */
    it("counts everybody in the group, each of them once", () => {
      expect(peopleHoldingRole({ assignments: rows, tier: "ADMIN" })).toBe(2);
    });

    /** @scenario A predefined role card describes the role it actually is */
    it("counts nobody for a tier nobody holds", () => {
      expect(peopleHoldingRole({ assignments: rows, tier: "VIEWER" })).toBe(0);
    });

    /** @scenario A custom role card names who holds it and where */
    it("counts a custom role by its own identifier, never by its tier", () => {
      const custom = [
        assignment({
          id: "c1",
          role: "CUSTOM",
          customRoleId: "role_1",
          customRoleName: "Support analyst",
          memberUserIds: [],
        }),
      ];

      expect(
        peopleHoldingCustomRole({
          assignments: custom,
          customRoleId: "role_1",
        }),
      ).toBe(1);
      expect(peopleHoldingRole({ assignments: custom, tier: "CUSTOM" })).toBe(
        0,
      );
    });
  });
});

describe("given a custom role assigned in two places", () => {
  const rows = [
    assignment({
      id: "c1",
      role: "CUSTOM",
      customRoleId: "role_1",
      customRoleName: "Support analyst",
      scopeType: "PROJECT",
      scopeId: "proj_1",
      scopeName: "support-copilot",
    }),
    assignment({
      id: "c2",
      role: "CUSTOM",
      customRoleId: "role_1",
      customRoleName: "Support analyst",
      scopeType: "PROJECT",
      scopeId: "proj_1",
      scopeName: "support-copilot",
      userId: "user_other",
      userName: "Other Person",
    }),
  ];

  describe("when the scopes it is in force on are gathered", () => {
    /** @scenario A custom role card names who holds it and where */
    it("names each place once, however many people hold it there", () => {
      expect(
        scopesOfCustomRole({ assignments: rows, customRoleId: "role_1" }),
      ).toEqual([
        {
          scopeType: "PROJECT",
          scopeId: "proj_1",
          scopeName: "support-copilot",
        },
      ]);
    });
  });
});

describe("given assignments spread across the scope kinds", () => {
  describe("when the filter counts them", () => {
    /** @scenario The scope filter carries the real numbers */
    it("counts assignments, not holders", () => {
      const counts = scopeCounts([
        assignment({ id: "a", scopeType: "ORGANIZATION", scopeId: "org" }),
        assignment({ id: "b", scopeType: "TEAM", scopeId: "team_1" }),
        assignment({ id: "c", scopeType: "TEAM", scopeId: "team_2" }),
        assignment({ id: "d", scopeType: "PROJECT", scopeId: "proj_1" }),
      ]);

      expect(counts).toEqual({
        ALL: 4,
        ORGANIZATION: 1,
        TEAM: 2,
        PROJECT: 1,
      });
    });
  });
});
