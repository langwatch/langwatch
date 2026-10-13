// Folding role assignments onto whoever holds them (main's roleHolders.unit.test.ts).
// Spec: specs/identity/org-access-cluster.feature

import { describe, expect, it } from "vitest";

import type { ManagedGrant } from "../managed-grant.ts";
import {
  holdersOf,
  peopleHoldingCustomRole,
  scopeCounts,
  scopesOfCustomRole,
  summariseScopes,
} from "../role-holders.ts";

function assignment(overrides: Partial<ManagedGrant> = {}): ManagedGrant {
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
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("given assignments that name no user and no group", () => {
  describe("when they are folded onto their holders", () => {
    it("keeps each API key its own row", () => {
      const holders = holdersOf([
        assignment({ id: "a", userId: null, apiKeyId: "k1", apiKeyName: "One" }),
        assignment({ id: "b", userId: null, apiKeyId: "k2", apiKeyName: "Two" }),
      ]);

      expect(holders.map((holder) => holder.name)).toEqual(["One", "Two"]);
      expect(new Set(holders.map((holder) => holder.key)).size).toBe(2);
    });

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

    it("falls back to the address, then to a sentence", () => {
      const [byAddress] = holdersOf([assignment({ userName: null })]);
      const [byNothing] = holdersOf([assignment({ userName: null, userEmail: null })]);

      expect(byAddress?.name).toBe("sam@acme.com");
      expect(byNothing?.name).toBe("A member with no name yet");
    });
  });
});

describe("given one person holding one role in many places", () => {
  const rows = [
    assignment({ id: "a", scopeType: "ORGANIZATION", scopeId: "org", scopeName: "Acme" }),
    assignment({ id: "b", scopeId: "team_1", scopeName: "Platform" }),
    assignment({ id: "c", scopeId: "team_2", scopeName: "Support" }),
  ];

  describe("when they are folded", () => {
    it("collapses to one row carrying one role", () => {
      const holders = holdersOf(rows);

      expect(holders).toHaveLength(1);
      expect(holders[0]?.grants).toHaveLength(1);
      expect(holders[0]?.grants[0]?.scopes).toHaveLength(3);
      expect(holders[0]?.assignmentCount).toBe(3);
    });

    it("counts the kinds of scope rather than naming them all", () => {
      const scopes = holdersOf(rows)[0]?.grants[0]?.scopes ?? [];

      expect(summariseScopes(scopes)).toBe("Organization, and 2 teams");
    });
  });
});

describe("given a custom role held directly and through a group", () => {
  const custom = { role: "CUSTOM" as const, customRoleId: "role_1", customRoleName: "Analyst" };

  describe("when the people holding it are counted", () => {
    /** @scenario A custom role card names who holds it and where */
    it("counts a custom role by its own identifier, each person once", () => {
      const rows = [
        assignment({ id: "c1", ...custom }),
        assignment({
          id: "c2",
          ...custom,
          userId: null,
          groupId: "g1",
          groupName: "Support",
          memberUserIds: ["user_sam", "user_b"],
        }),
      ];

      expect(peopleHoldingCustomRole({ assignments: rows, customRoleId: "role_1" })).toBe(2);
    });
  });
});

describe("given a custom role assigned in one place to two people", () => {
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
      expect(scopesOfCustomRole({ assignments: rows, customRoleId: "role_1" })).toEqual([
        { scopeType: "PROJECT", scopeId: "proj_1", scopeName: "support-copilot" },
      ]);
    });
  });
});

describe("given assignments spread across the scope kinds", () => {
  describe("when the filter counts them", () => {
    it("counts assignments, not holders", () => {
      const counts = scopeCounts([
        assignment({ id: "a", scopeType: "ORGANIZATION", scopeId: "org" }),
        assignment({ id: "b", scopeType: "TEAM", scopeId: "team_1" }),
        assignment({ id: "c", scopeType: "TEAM", scopeId: "team_2" }),
        assignment({ id: "d", scopeType: "PROJECT", scopeId: "proj_1" }),
      ]);

      expect(counts).toEqual({ ALL: 4, ORGANIZATION: 1, TEAM: 2, PROJECT: 1 });
    });
  });
});
