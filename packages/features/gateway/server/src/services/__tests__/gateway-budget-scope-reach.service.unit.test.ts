/**
 * Whether a spending limit can actually catch any traffic.
 *
 * This is the answer behind "no active keys reach this budget" in the UI, so a
 * wrong `reachable` is a money bug in either direction: claim reachable and the
 * customer trusts a limit that never fires; claim unreachable and they go
 * looking for a problem that is not there.
 *
 * Each scope type reads a different field off the key, and crossing any two of
 * them is invisible in a single-scope test — so all seven are pinned, each
 * against a key that matches on its own field and on no other.
 */

import { describe, expect, it } from "vitest";
import { GatewayBudgetScopeReachService } from "../gateway-budget-scope-reach.service";

const candidate = (over: Record<string, unknown> = {}) => ({
  organizationId: "organization-1",
  scopedTeamIds: ["team-1"],
  traceProjectId: "project-1",
  virtualKeyId: "vk-1",
  principalUserId: "user-1",
  groupIds: ["group-1"],
  ...over,
});

const traceProject = (over: Record<string, unknown> = {}) => ({
  id: "project-1",
  teamId: "team-9",
  ...over,
});

const service = GatewayBudgetScopeReachService.create();

function reaches(scopeType: string, scopeId: string, over: Record<string, unknown> = {}) {
  return service.resolveScope({
    candidates: [candidate(over) as never],
    traceProjects: [traceProject() as never],
    scope: { scopeType, scopeId } as never,
  }).reachable;
}

describe("GatewayBudgetScopeReachService", () => {
  describe("given each scope type", () => {
    const matching: Array<[string, string]> = [
      ["ORGANIZATION", "organization-1"],
      ["TEAM", "team-1"],
      ["PROJECT", "project-1"],
      ["VIRTUAL_KEY", "vk-1"],
      ["PRINCIPAL", "user-1"],
      ["GROUP", "group-1"],
    ];

    for (const [scopeType, scopeId] of matching) {
      it(`reaches a ${scopeType} budget through the key's own ${scopeType.toLowerCase()}`, () => {
        expect(reaches(scopeType, scopeId)).toBe(true);
      });

      it(`does not reach a ${scopeType} budget for some other ${scopeType.toLowerCase()}`, () => {
        expect(reaches(scopeType, "something-else")).toBe(false);
      });
    }

    // Every id above is distinct, so a scope type reading the wrong field off
    // the key answers false here rather than accidentally matching.
    it("does not match one scope type's id against another's field", () => {
      expect(reaches("ORGANIZATION", "team-1")).toBe(false);
      expect(reaches("TEAM", "organization-1")).toBe(false);
      expect(reaches("PROJECT", "vk-1")).toBe(false);
      expect(reaches("VIRTUAL_KEY", "project-1")).toBe(false);
      expect(reaches("PRINCIPAL", "group-1")).toBe(false);
      expect(reaches("GROUP", "user-1")).toBe(false);
    });
  });

  describe("given an ATTRIBUTED_USER budget", () => {
    it("reaches through the virtual key", () => {
      expect(reaches("ATTRIBUTED_USER", "vk-1")).toBe(true);
    });

    it("reaches through the project too", () => {
      expect(reaches("ATTRIBUTED_USER", "project-1")).toBe(true);
    });

    it("does not reach through anything else", () => {
      expect(reaches("ATTRIBUTED_USER", "user-1")).toBe(false);
    });
  });

  describe("given a scope type nothing here handles", () => {
    it("says so, rather than reporting the budget unreachable", () => {
      // Answering false would read as a real verdict and send the customer
      // looking for keys that do not exist.
      expect(() => reaches("SOMETHING_NEW", "whatever")).toThrow(/Unsupported/);
    });
  });

  describe("given a key whose trace project belongs to a team it is not scoped to", () => {
    it("reaches a TEAM budget for that project's team as well", () => {
      // Routing traffic at a project is what puts the key in that project's
      // team, so a team budget there does catch it.
      expect(reaches("TEAM", "team-9")).toBe(true);
    });
  });

  describe("given a key naming a trace project that is not in the list", () => {
    it("reaches no PROJECT budget, and picks up no team from it", () => {
      expect(reaches("PROJECT", "project-1", { traceProjectId: "project-missing" })).toBe(false);
      expect(reaches("TEAM", "team-9", { traceProjectId: "project-missing" })).toBe(false);
    });
  });

  describe("given a key routing nowhere", () => {
    it("reaches no PROJECT budget", () => {
      expect(reaches("PROJECT", "project-1", { traceProjectId: null })).toBe(false);
    });
  });

  describe("resolveScope", () => {
    it("counts the active keys and lists the projects they reach, without repeats", () => {
      const result = service.resolveScope({
        candidates: [
          candidate() as never,
          candidate({ virtualKeyId: "vk-2" }) as never,
          candidate({ virtualKeyId: "vk-3", traceProjectId: null }) as never,
        ],
        traceProjects: [traceProject() as never],
        scope: { scopeType: "ORGANIZATION", scopeId: "organization-1" } as never,
      });

      expect(result).toEqual({
        reachable: true,
        reachableProjectIds: ["project-1"],
        activeKeyCount: 3,
      });
    });
  });

  describe("resolveBudgets", () => {
    it("answers for every budget it was given, keyed by id", () => {
      const result = service.resolveBudgets({
        candidates: [candidate() as never],
        traceProjects: [traceProject() as never],
        budgets: [
          { id: "budget-1", scopeType: "ORGANIZATION", scopeId: "organization-1" },
          { id: "budget-2", scopeType: "PROJECT", scopeId: "project-other" },
        ] as never,
      });

      expect([...result.keys()]).toEqual(["budget-1", "budget-2"]);
      expect(result.get("budget-1")).toEqual({
        budgetId: "budget-1",
        reachable: true,
        reachableProjectIds: ["project-1"],
      });
      expect(result.get("budget-2")?.reachable).toBe(false);
    });

    it("answers for no budgets when there are none, rather than failing", () => {
      const result = service.resolveBudgets({
        candidates: [candidate() as never],
        traceProjects: [],
        budgets: [],
      });

      expect(result.size).toBe(0);
    });

    it("finds nothing reachable when no key is active", () => {
      const result = service.resolveBudgets({
        candidates: [],
        traceProjects: [traceProject() as never],
        budgets: [
          { id: "budget-1", scopeType: "ORGANIZATION", scopeId: "organization-1" },
        ] as never,
      });

      expect(result.get("budget-1")).toEqual({
        budgetId: "budget-1",
        reachable: false,
        reachableProjectIds: [],
      });
    });
  });
});
