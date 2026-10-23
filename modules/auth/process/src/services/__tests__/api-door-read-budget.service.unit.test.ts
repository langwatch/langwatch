/**
 * The allowances and the enforcement switch the read budget asks, per scope.
 * @see specs/security/read-rate-limits.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiDoorReadBudgetService,
  MAX_CACHED_SCOPES,
  READ_RATE_LIMITS_ENFORCED_FLAG,
} from "../api-door-read-budget.service.ts";

const ORGANIZATION_BOUND = 7;

function serviceWith({ enforced = false }: { enforced?: boolean } = {}) {
  const asked = {
    projects: [] as string[],
    flags: [] as FeatureFlagTarget[],
    bounds: [] as Parameters<EntitlementApi["requestBound"]>[0][],
    failNextProject: false,
  };
  const projects = createApiFixture<ProjectApi>({
    getOrganizationId: async (projectId) => {
      asked.projects.push(projectId);
      if (!asked.failNextProject) return `org-of-${projectId}`;
      asked.failNextProject = false;
      throw new Error("project store away");
    },
  });
  const featureFlags = createApiFixture<FeatureFlagApi>({
    isEnabled: async (flag, target) => {
      if (flag === READ_RATE_LIMITS_ENFORCED_FLAG) asked.flags.push(target);
      return enforced;
    },
  });
  const entitlements = createApiFixture<EntitlementApi>({
    requestBound: async (input) => {
      asked.bounds.push(input);
      return ORGANIZATION_BOUND;
    },
  });
  const service = ApiDoorReadBudgetService.create({ projects, featureFlags, entitlements });

  return { service, asked };
}

const project = (id: string) => ({ tier: "project", id }) as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ApiDoorReadBudgetService", () => {
  describe("given a project scope", () => {
    it("answers the project's organization and its plan's allowances", async () => {
      const { service, asked } = serviceWith();

      const resolved = await service.limitsFor({ scope: project("p1") });

      expect(resolved.organizationId).toBe("org-of-p1");
      expect(resolved.limits.readsPerMinute).toBe(ORGANIZATION_BOUND);
      expect(asked.bounds).toContainEqual({
        key: "readRequestsPerMinute",
        organizationId: "org-of-p1",
      });
    });
  });

  describe("given an organization scope", () => {
    it("asks that organization's allowances without a project lookup", async () => {
      const { service, asked } = serviceWith();

      const resolved = await service.limitsFor({ scope: { tier: "organization", id: "org-9" } });

      expect(resolved.organizationId).toBe("org-9");
      expect(asked.projects).toEqual([]);
    });
  });

  describe("given a call naming no tenant", () => {
    it("answers the paid tier's allowances without asking a plan", async () => {
      const { service, asked } = serviceWith();

      const resolved = await service.limitsFor({ scope: null });

      expect(resolved.organizationId).toBeNull();
      expect(resolved.limits.readsPerMinute).toBe(
        resolveRequestBound("readRequestsPerMinute", "PRO"),
      );
      expect(asked.bounds).toEqual([]);
    });
  });

  describe("when one scope is asked twice within a minute", () => {
    it("resolves it once, and again once the minute has passed", async () => {
      const { service, asked } = serviceWith();

      await service.limitsFor({ scope: project("p1") });
      await service.limitsFor({ scope: project("p1") });
      expect(asked.projects).toEqual(["p1"]);

      vi.advanceTimersByTime(60_001);
      await service.limitsFor({ scope: project("p1") });
      expect(asked.projects).toEqual(["p1", "p1"]);
    });
  });

  describe("when a resolution fails", () => {
    it("is not cached, so the next call asks again", async () => {
      const { service, asked } = serviceWith();
      asked.failNextProject = true;

      await expect(service.limitsFor({ scope: project("p1") })).rejects.toThrow("away");
      await service.limitsFor({ scope: project("p1") });

      expect(asked.projects).toEqual(["p1", "p1"]);
    });
  });

  describe("when more scopes are seen than the cache holds", () => {
    it("drops the one held longest and keeps the rest", async () => {
      const { service, asked } = serviceWith();

      for (let index = 0; index <= MAX_CACHED_SCOPES; index++) {
        await service.limitsFor({ scope: project(`p${index}`) });
      }
      asked.projects.length = 0;

      await service.limitsFor({ scope: project(`p${MAX_CACHED_SCOPES}`) });
      await service.limitsFor({ scope: project("p0") });

      expect(asked.projects).toEqual(["p0"]);
    });
  });

  describe("when enforcement is asked", () => {
    it("reads the flag for the scope's organization", async () => {
      const { service, asked } = serviceWith({ enforced: true });

      expect(await service.enforced({ scope: project("p1") })).toBe(true);
      expect(asked.flags).toEqual([{ kind: "organization", organizationId: "org-of-p1" }]);
    });

    it("reads the system flag for a call naming no tenant", async () => {
      const { service, asked } = serviceWith();

      expect(await service.enforced({ scope: null })).toBe(false);
      expect(asked.flags).toEqual([{ kind: "system" }]);
    });
  });
});
