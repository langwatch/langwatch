/**
 * @vitest-environment node
 * A saved period reaching stored data: a longer one raises every project's rows at once, and the
 * count of stored items past a period covers the readable projects under the scope.
 * @see modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  createDataRetentionTestApp,
  createDataRetentionTestProjectScopes,
  MemoryRetentionDirectory,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import type { DataRetentionDirectoryReader } from "../../app/data-retention.app.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";

const organizationId = retentionTestGraph.organizationId ?? "";
const organization = { scopeType: "ORGANIZATION" as const, scopeId: organizationId };
const projectIds = [retentionTestGraph.projectId, "project-2", "project-hidden"];

/** The organization's three projects; `project-hidden` is one the admin cannot read. */
function directory(): DataRetentionDirectoryReader {
  const base = MemoryRetentionDirectory.create();
  return {
    findProjectLineage: (input) => base.findProjectLineage(input),
    findOrganizationDirectory: () => base.findOrganizationDirectory(),
    findOrganizationCreatedAt: () => base.findOrganizationCreatedAt(),
    findScopeProjects: async () =>
      projectIds.map((id) => ({ id, teamId: retentionTestGraph.teamId })),
  };
}

function authz(): AuthzApi {
  return createApiFixture<AuthzApi>({
    can: vi.fn(async () => false),
    hasPermission: vi.fn(async () => true),
    canBatchByIds: vi.fn(async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, true])),
      projects: new Map(
        input.projects.map((project) => [
          project.projectId,
          project.projectId !== "project-hidden",
        ]),
      ),
      organizationRole: null,
    })),
  });
}

function harness() {
  const retroactive = MemoryRetroactiveRetentionRepository.create();
  const app = createDataRetentionTestApp({
    repositories: {
      ...MemoryDataRetentionRepositories.create(),
      retroactive,
      directory: directory(),
      projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, projectIds.slice(1)),
    },
    dependencies: { permissions: authz() },
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const extension = eventing.register(
    app.retentionExtensionPipeline({ applyRetryDelayMs: () => 10 }),
  );
  app.connectRetentionExtensionCommands(extension.commands);
  return { app, eventing, retroactive };
}

describe("given an organization with three projects and stored data", () => {
  describe("when an admin saves a longer period for the organization", () => {
    /** @scenario "A longer period is applied to stored data without asking" */
    it("raises every project's stored traces to it without being asked", async () => {
      const { app, eventing, retroactive } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 35,
        });
        await app.changeScopeRetention({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
          userId: "user-1",
        });

        await vi.waitFor(() => expect(retroactive.raises).toHaveLength(projectIds.length), {
          timeout: 10_000,
        });
        expect(retroactive.raises.map((raise) => raise.projectId).toSorted()).toEqual(
          [...projectIds].toSorted(),
        );
        expect(retroactive.raises.every((raise) => raise.retentionDays === 91)).toBe(true);
        expect(retroactive.applies).toHaveLength(0);
      } finally {
        await eventing.close();
      }
    });

    it("raises nothing when the save shortens the period", async () => {
      const { app, eventing, retroactive } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 182,
        });
        await app.changeScopeRetention({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
          userId: "user-1",
        });
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(retroactive.raises).toHaveLength(0);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when the stored data past the organization's period is counted", () => {
    /** @scenario "The count covers every project the admin can read under the scope" */
    it("sums the readable projects, each at its own period, and leaves the hidden one out", async () => {
      const { app, eventing, retroactive } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
        });
        await app.setForScope({
          organizationId,
          scope: { scopeType: "PROJECT", scopeId: "project-2" },
          category: "traces",
          retentionDays: 182,
        });
        retroactive.storedItems.set(`${retentionTestGraph.projectId}/traces`, [
          { ageDays: 120, retentionDays: 371 },
          { ageDays: 10, retentionDays: 371 },
        ]);
        retroactive.storedItems.set("project-2/traces", [
          { ageDays: 120, retentionDays: 371 },
          { ageDays: 200, retentionDays: 0 },
        ]);
        retroactive.storedItems.set("project-hidden/traces", [{ ageDays: 400, retentionDays: 0 }]);

        const counted = await app.getStoredPastRetention({
          projectId: retentionTestGraph.projectId,
          scope: organization,
          userId: "user-1",
        });

        expect(counted.projectCount).toBe(2);
        expect(counted.categories.find((each) => each.category === "traces")).toEqual({
          category: "traces",
          rows: 2,
          retentionDays: null,
        });
      } finally {
        await eventing.close();
      }
    });
  });
});
