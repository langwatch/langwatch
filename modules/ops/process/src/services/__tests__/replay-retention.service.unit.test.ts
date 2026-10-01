import type { DataRetentionApi, ResolvedRetention } from "@langwatch/data-retention-contract";
/**
 * @vitest-environment node
 * The retention a replay stamps on rebuilt rows, asked of data retention per tenant.
 * Spec: modules/ops/specs/projection-replay-console.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ReplayRetentionService } from "../replay-retention.service.ts";

const PLATFORM_DEFAULT: ResolvedRetention = { traces: 30, scenarios: 30, experiments: 30 };

function retentionAnswering(byProject: Readonly<Record<string, ResolvedRetention>>) {
  const getResolvedForProject = vi.fn(async ({ projectId }: { projectId: string }) => {
    return byProject[projectId] ?? PLATFORM_DEFAULT;
  });
  return {
    api: createApiFixture<DataRetentionApi>({ getResolvedForProject }),
    getResolvedForProject,
  };
}

describe("ReplayRetentionService", () => {
  describe("given two tenants with different retention policies", () => {
    /** @scenario "Rebuilt rows take each tenant's retention" */
    it("answers each tenant's own resolved retention, asked with the tenant as the project", async () => {
      const longer = { ...PLATFORM_DEFAULT, traces: 365 };
      const shorter = { ...PLATFORM_DEFAULT, traces: 7 };
      const { api, getResolvedForProject } = retentionAnswering({
        project_a: longer,
        project_b: shorter,
      });
      const resolver = ReplayRetentionService.create(api);

      await expect(resolver.resolve("project_a")).resolves.toEqual(longer);
      await expect(resolver.resolve("project_b")).resolves.toEqual(shorter);
      expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project_a" });
      expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project_b" });
    });
  });

  describe("given a tenant data retention cannot place", () => {
    /** @scenario "A tenant with no retention policy of its own takes the platform default" */
    it("answers the platform default data retention gives, never an indefinite retention", async () => {
      const { api } = retentionAnswering({});
      const resolver = ReplayRetentionService.create(api);

      await expect(resolver.resolve("project_gone")).resolves.toEqual(PLATFORM_DEFAULT);
    });
  });

  describe("given data retention refuses", () => {
    /** @scenario "A replay whose tenant retention cannot be read fails rather than guessing" */
    it("passes the refusal on rather than stamping a default", async () => {
      const api = createApiFixture<DataRetentionApi>({
        getResolvedForProject: async () => {
          throw new Error("retention store unavailable");
        },
      });
      const resolver = ReplayRetentionService.create(api);

      await expect(resolver.resolve("project_a")).rejects.toThrow("retention store unavailable");
    });
  });
});
