import { describe, it, expect } from "vitest";
import { resolveRetention, type RetentionRow } from "../resolveRetentionDays";
import { resolveScopeChain } from "../../scopes/resolveScopeChain";

const CHAIN = resolveScopeChain({
  organizationId: "org-1",
  teamId: "team-1",
  projectId: "proj-1",
});

const row = (
  scopeType: RetentionRow["scopeType"],
  scopeId: string,
  category: string,
  retentionDays: number,
): RetentionRow => ({ scopeType, scopeId, category, retentionDays });

describe("resolveRetention", () => {
  describe("given a project-level override", () => {
    it("returns the project value for that category", () => {
      const resolved = resolveRetention({
        rows: [row("PROJECT", "proj-1", "traces", 90)],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(90);
    });
  });

  describe("given overrides at every tier for one category", () => {
    it("the project tier wins (most specific)", () => {
      const resolved = resolveRetention({
        rows: [
          row("ORGANIZATION", "org-1", "traces", 30),
          row("TEAM", "team-1", "traces", 60),
          row("PROJECT", "proj-1", "traces", 90),
        ],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(90);
    });
  });

  describe("given a team override but no project override", () => {
    it("the team tier sits between org and project", () => {
      const resolved = resolveRetention({
        rows: [
          row("ORGANIZATION", "org-1", "traces", 30),
          row("TEAM", "team-1", "traces", 60),
        ],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(60);
    });
  });

  describe("given only an organization override", () => {
    it("the org value applies when no closer override exists", () => {
      const resolved = resolveRetention({
        rows: [row("ORGANIZATION", "org-1", "scenarios", 45)],
        chain: CHAIN,
      });
      expect(resolved.scenarios).toBe(45);
    });
  });

  describe("given categories overridden at different tiers", () => {
    it("resolves each category independently", () => {
      const resolved = resolveRetention({
        rows: [
          row("PROJECT", "proj-1", "traces", 90),
          row("TEAM", "team-1", "scenarios", 60),
          row("ORGANIZATION", "org-1", "experiments", 30),
        ],
        chain: CHAIN,
      });
      expect(resolved).toEqual({ traces: 90, scenarios: 60, experiments: 30 });
    });
  });

  describe("given no row for a category", () => {
    it("resolves to 0 (indefinite)", () => {
      const resolved = resolveRetention({
        rows: [row("PROJECT", "proj-1", "traces", 90)],
        chain: CHAIN,
      });
      expect(resolved.scenarios).toBe(0);
      expect(resolved.experiments).toBe(0);
    });
  });

  describe("given a row from a sibling scope not in the chain", () => {
    it("is ignored", () => {
      const resolved = resolveRetention({
        rows: [row("PROJECT", "other-project", "traces", 90)],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(0);
    });
  });
});
