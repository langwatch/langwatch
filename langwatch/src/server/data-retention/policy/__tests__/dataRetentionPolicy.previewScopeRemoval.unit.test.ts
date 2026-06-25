import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "../../retentionPolicy.schema";
import { DataRetentionPolicyService } from "../dataRetentionPolicy.service";

/**
 * `previewScopeRemoval` answers the question the remove-confirmation dialog
 * asks: "if I delete this rule, what retention does the data fall back to?".
 * It must mirror exactly what a real removal would resolve to — the next tier
 * in the cascade, or the platform default — so the dialog never shows a number
 * that differs from reality.
 */
describe("DataRetentionPolicyService.previewScopeRemoval", () => {
  const repository = {
    findOrganizationForScope: vi.fn(),
    findAllInOrganization: vi.fn(),
    getScopeCascadeChain: vi.fn(),
  };
  const cache = {} as any;
  const service = new DataRetentionPolicyService(repository as any, cache);

  const PROJECT_SCOPE: ScopeAssignment = {
    scopeType: "PROJECT",
    scopeId: "proj-1",
  };
  const PROJECT_CHAIN: ScopeAssignment[] = [
    { scopeType: "PROJECT", scopeId: "proj-1" },
    { scopeType: "TEAM", scopeId: "team-1" },
    { scopeType: "ORGANIZATION", scopeId: "org-1" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findOrganizationForScope.mockResolvedValue("org-1");
    repository.getScopeCascadeChain.mockResolvedValue(PROJECT_CHAIN);
  });

  describe("given a project override with a team rule above it", () => {
    it("falls back to the team value", async () => {
      repository.findAllInOrganization.mockResolvedValue([
        { scopeType: "PROJECT", scopeId: "proj-1", category: "traces", retentionDays: 91 },
        { scopeType: "TEAM", scopeId: "team-1", category: "traces", retentionDays: 63 },
      ]);

      const result = await service.previewScopeRemoval(PROJECT_SCOPE);

      expect(result.traces).toBe(63);
    });
  });

  describe("given a project override with only an org rule above it", () => {
    it("falls back to the org value", async () => {
      repository.findAllInOrganization.mockResolvedValue([
        { scopeType: "PROJECT", scopeId: "proj-1", category: "traces", retentionDays: 91 },
        { scopeType: "ORGANIZATION", scopeId: "org-1", category: "traces", retentionDays: 182 },
      ]);

      const result = await service.previewScopeRemoval(PROJECT_SCOPE);

      expect(result.traces).toBe(182);
    });
  });

  describe("given a project override and nothing else in the chain", () => {
    it("falls back to the platform default", async () => {
      repository.findAllInOrganization.mockResolvedValue([
        { scopeType: "PROJECT", scopeId: "proj-1", category: "traces", retentionDays: 91 },
      ]);

      const result = await service.previewScopeRemoval(PROJECT_SCOPE);

      expect(result.traces).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });

  describe("given an organization override being removed", () => {
    it("falls back to the platform default for every category", async () => {
      const orgScope: ScopeAssignment = {
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
      };
      repository.getScopeCascadeChain.mockResolvedValue([orgScope]);
      repository.findAllInOrganization.mockResolvedValue([
        { scopeType: "ORGANIZATION", scopeId: "org-1", category: "traces", retentionDays: 91 },
        { scopeType: "ORGANIZATION", scopeId: "org-1", category: "scenarios", retentionDays: 91 },
        { scopeType: "ORGANIZATION", scopeId: "org-1", category: "experiments", retentionDays: 91 },
      ]);

      const result = await service.previewScopeRemoval(orgScope);

      expect(result).toEqual({
        traces: PLATFORM_DEFAULT_RETENTION_DAYS,
        scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      });
    });
  });

  describe("given the removed scope diverges per category", () => {
    it("resolves each category's fallback independently", async () => {
      repository.findAllInOrganization.mockResolvedValue([
        // traces falls back to the team rule below
        { scopeType: "PROJECT", scopeId: "proj-1", category: "traces", retentionDays: 735 },
        { scopeType: "TEAM", scopeId: "team-1", category: "traces", retentionDays: 63 },
        // scenarios falls back to the org rule
        { scopeType: "PROJECT", scopeId: "proj-1", category: "scenarios", retentionDays: 735 },
        { scopeType: "ORGANIZATION", scopeId: "org-1", category: "scenarios", retentionDays: 182 },
        // experiments has no tier above → platform default
        { scopeType: "PROJECT", scopeId: "proj-1", category: "experiments", retentionDays: 735 },
      ]);

      const result = await service.previewScopeRemoval(PROJECT_SCOPE);

      expect(result).toEqual({
        traces: 63,
        scenarios: 182,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      });
    });
  });

  describe("given the scope's organization cannot be resolved", () => {
    it("falls back to the platform default for every category", async () => {
      repository.findOrganizationForScope.mockResolvedValue(null);

      const result = await service.previewScopeRemoval(PROJECT_SCOPE);

      expect(result).toEqual({
        traces: PLATFORM_DEFAULT_RETENTION_DAYS,
        scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      });
      expect(repository.findAllInOrganization).not.toHaveBeenCalled();
    });
  });
});
