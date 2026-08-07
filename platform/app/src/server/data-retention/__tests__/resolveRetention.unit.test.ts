import { describe, expect, it } from "vitest";
import { resolveScopeChain } from "../../scopes/resolveScopeChain";
import { type RetentionRow, resolveRetention } from "../resolveRetentionDays";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "../retentionPolicy.schema";

const CHAIN = resolveScopeChain({
  organizationId: "org-1",
  teamId: "team-1",
  projectId: "proj-1",
});

const row = ({
  scopeType,
  scopeId,
  category,
  retentionDays,
}: {
  scopeType: RetentionRow["scopeType"];
  scopeId: string;
  category: string;
  retentionDays: number;
}): RetentionRow => ({ scopeType, scopeId, category, retentionDays });

describe("resolveRetention", () => {
  describe("given a project-level override", () => {
    it("returns the project value for that category", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "PROJECT",
            scopeId: "proj-1",
            category: "traces",
            retentionDays: 90,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(90);
    });
  });

  describe("given overrides at every tier for one category", () => {
    it("the project tier wins (most specific)", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            category: "traces",
            retentionDays: 30,
          }),
          row({
            scopeType: "TEAM",
            scopeId: "team-1",
            category: "traces",
            retentionDays: 60,
          }),
          row({
            scopeType: "PROJECT",
            scopeId: "proj-1",
            category: "traces",
            retentionDays: 90,
          }),
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
          row({
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            category: "traces",
            retentionDays: 30,
          }),
          row({
            scopeType: "TEAM",
            scopeId: "team-1",
            category: "traces",
            retentionDays: 60,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(60);
    });
  });

  describe("given only an organization override", () => {
    it("the org value applies when no closer override exists", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            category: "scenarios",
            retentionDays: 45,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved.scenarios).toBe(45);
    });
  });

  describe("given categories overridden at different tiers", () => {
    it("resolves each category independently", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "PROJECT",
            scopeId: "proj-1",
            category: "traces",
            retentionDays: 90,
          }),
          row({
            scopeType: "TEAM",
            scopeId: "team-1",
            category: "scenarios",
            retentionDays: 60,
          }),
          row({
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            category: "experiments",
            retentionDays: 30,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved).toEqual({ traces: 90, scenarios: 60, experiments: 30 });
    });
  });

  describe("given no row for a category", () => {
    it("falls back to the platform default", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "PROJECT",
            scopeId: "proj-1",
            category: "traces",
            retentionDays: 91,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved.scenarios).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
      expect(resolved.experiments).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });

  describe("given a row from a sibling scope not in the chain", () => {
    it("is ignored", () => {
      const resolved = resolveRetention({
        rows: [
          row({
            scopeType: "PROJECT",
            scopeId: "other-project",
            category: "traces",
            retentionDays: 91,
          }),
        ],
        chain: CHAIN,
      });
      expect(resolved.traces).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });
});
