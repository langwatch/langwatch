/**
 * How a project's retention resolves through its scope chain, and what a write or removal does to
 * it. Spec: specs/data-retention/retention-policy-configuration.feature
 */
import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionCacheRepository } from "../../repositories/memory/memory.data-retention-cache.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "../../repositories/memory/memory.pinned-trace.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import { MemoryStorageMeterCacheRepository } from "../../repositories/memory/memory.storage-meter-cache.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import { DataRetentionService } from "../data-retention.service.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

const DEFAULT_DAYS = 49;
const PROJECT = retentionTestGraph.projectId;
const ORGANIZATION = retentionTestGraph.organizationId ?? "organization-1";
const TEAM = retentionTestGraph.teamId ?? "team-1";

const ORGANIZATION_SCOPE = { scopeType: "ORGANIZATION", scopeId: ORGANIZATION } as const;
const TEAM_SCOPE = { scopeType: "TEAM", scopeId: TEAM } as const;
const PROJECT_SCOPE = { scopeType: "PROJECT", scopeId: PROJECT } as const;

function acme() {
  return DataRetentionService.create({
    policies: MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projects: createDataRetentionTestProjects(),
    organizations: createDataRetentionTestOrganizations(),
    defaultRetentionDays: DEFAULT_DAYS,
    retroactive: MemoryRetroactiveRetentionRepository.create(),
    cache: MemoryDataRetentionCacheRepository.create(),
    storageMeter: StorageMeterService.create({
      meter: MemoryStorageMeterRepository.create(),
      cache: MemoryStorageMeterCacheRepository.create(),
    }),
  });
}

const daysOf = (service: DataRetentionService, category: RetentionCategory) =>
  service.getRetentionDays({ projectId: PROJECT, category });

describe("given the scope chain of project web-app", () => {
  describe("when no override exists anywhere in the chain", () => {
    /** @scenario "A project with no override resolves to the platform default" */
    it("resolves every category to the platform default", async () => {
      const service = acme();

      for (const category of ["traces", "scenarios", "experiments"] as const) {
        await expect(daysOf(service, category)).resolves.toBe(DEFAULT_DAYS);
      }
    });
  });

  describe("when only the organization holds an override", () => {
    /** @scenario "An organization override applies to every project in the org" */
    it("applies it to the project", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 63,
      });

      await expect(daysOf(service, "traces")).resolves.toBe(63);
    });
  });

  describe("when the organization and the project both hold one", () => {
    /** @scenario "A project override beats an organization override" */
    it("resolves the project's", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 49,
      });
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });

      await expect(daysOf(service, "traces")).resolves.toBe(91);
    });
  });

  describe("when the organization and the team both hold one", () => {
    /** @scenario "A team override sits between organization and project" */
    it("resolves the team's", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 49,
      });
      await service.setForScope({ scope: TEAM_SCOPE, category: "traces", retentionDays: 63 });

      await expect(daysOf(service, "traces")).resolves.toBe(63);
    });
  });

  describe("when each category is overridden at a different tier", () => {
    /** @scenario "Categories resolve independently across tiers" */
    it("resolves each category from its own tier", async () => {
      const service = acme();
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });
      await service.setForScope({ scope: TEAM_SCOPE, category: "scenarios", retentionDays: 63 });
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "experiments",
        retentionDays: 49,
      });

      await expect(daysOf(service, "traces")).resolves.toBe(91);
      await expect(daysOf(service, "scenarios")).resolves.toBe(63);
      await expect(daysOf(service, "experiments")).resolves.toBe(49);
    });
  });

  describe("when an admin sets a length under the minimum", () => {
    /** @scenario "Minimum retention enforced at 49 days" */
    it("rejects it and names the 49-day minimum", async () => {
      const service = acme();

      await expect(
        service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 14 }),
      ).rejects.toThrow(/49 days/);
    });
  });

  describe("when an admin sets a length that is not whole weeks", () => {
    /** @scenario "Retention must be a whole number of weeks" */
    it("rejects it and names the multiple of 7", async () => {
      const service = acme();

      await expect(
        service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 50 }),
      ).rejects.toThrow(/multiple of 7 days/);
    });
  });

  describe("when the project override is removed", () => {
    /** @scenario "Removing a project override falls back to the next tier" */
    it("resolves the organization's rule again", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 63,
      });
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });
      await expect(daysOf(service, "traces")).resolves.toBe(91);

      await service.removeForScope({ scope: PROJECT_SCOPE, category: "traces" });

      await expect(daysOf(service, "traces")).resolves.toBe(63);
    });
  });

  describe("when a policy's value is edited", () => {
    /** @scenario "Editing a policy from the row overflow menu changes only its value" */
    it("keeps its scope and resolves the new value", async () => {
      const service = acme();
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });

      const edited = await service.setForScope({
        scope: PROJECT_SCOPE,
        category: "traces",
        retentionDays: 182,
      });

      expect(edited).toMatchObject({ scopeType: "PROJECT", scopeId: PROJECT });
      await expect(daysOf(service, "traces")).resolves.toBe(182);
      expect(await service.listOrganizationRules({ organizationId: ORGANIZATION })).toHaveLength(1);
    });
  });

  describe("when removal of the project policy is previewed", () => {
    /** @scenario "Removal asks for confirmation and previews the real fallback value" */
    it("shows the value it would fall back to without removing anything", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 49,
      });
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });

      const preview = await service.previewScopeRemoval({ scope: PROJECT_SCOPE });

      expect(preview.traces).toBe(49);
      await expect(daysOf(service, "traces")).resolves.toBe(91);
    });
  });

  describe("when removal of a project policy is previewed over an organization rule", () => {
    /** @scenario "The previewed fallback never leaks a rule the caller cannot read" */
    it("answers with the resolved day counts alone, naming no scope", async () => {
      const service = acme();
      await service.setForScope({
        scope: ORGANIZATION_SCOPE,
        category: "traces",
        retentionDays: 63,
      });
      await service.setForScope({ scope: PROJECT_SCOPE, category: "traces", retentionDays: 91 });

      const preview = await service.previewScopeRemoval({ scope: PROJECT_SCOPE });

      expect(preview).toEqual({ traces: 63, scenarios: DEFAULT_DAYS, experiments: DEFAULT_DAYS });
    });
  });

  describe("when a team-level override is set", () => {
    /** @scenario "An override is anchored to a single organization" */
    it("is stored against the organization that owns the team", async () => {
      const service = acme();

      const row = await service.setForScope({
        scope: TEAM_SCOPE,
        category: "traces",
        retentionDays: 63,
      });

      expect(row.organizationId).toBe(ORGANIZATION);
      expect(
        await service.listOrganizationRules({ organizationId: "another-organization" }),
      ).toEqual([]);
    });
  });
});
