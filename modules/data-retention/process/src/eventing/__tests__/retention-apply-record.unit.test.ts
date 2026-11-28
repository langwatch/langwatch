/**
 * @vitest-environment node
 * Every save records a retention_policy_changed fact for its scope, every project's rewrite names
 * the scope that asked for it, and the snapshot reads whether each scope's change was applied.
 * @see modules/data-retention/specs/retention-apply-record.feature
 */
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import {
  createDataRetentionTestApp,
  createDataRetentionTestProjectScopes,
  MemoryRetentionDirectory,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionRepositories } from "../../repositories/memory/memory.data-retention.repositories.ts";
import { MemoryRetentionApplyStatusRepository } from "../../repositories/memory/memory.retention-apply-status.repository.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  retentionAppliedEventDataSchema,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
  RETENTION_POLICY_CHANGED_EVENT_TYPE,
  retentionPolicyChangedEventDataSchema,
} from "../retention-extension.events.ts";

const organizationId = retentionTestGraph.organizationId ?? "";
const organization = { scopeType: "ORGANIZATION" as const, scopeId: organizationId };
const projectIds = [retentionTestGraph.projectId, "project-2"];

function harness({
  connected = true,
  changeFails = false,
}: { connected?: boolean; changeFails?: boolean } = {}) {
  const retroactive = MemoryRetroactiveRetentionRepository.create();
  const applyStatus = MemoryRetentionApplyStatusRepository.create();
  const app = createDataRetentionTestApp({
    repositories: {
      ...MemoryDataRetentionRepositories.create(),
      retroactive,
      applyStatus,
      directory: MemoryRetentionDirectory.create(),
      projectScopes: createDataRetentionTestProjectScopes(retentionTestGraph, ["project-2"]),
    },
  });
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const extension = eventing.register(
    app.retentionExtensionPipeline({ applyRetryDelayMs: () => 10 }),
  );
  if (connected) {
    app.connectRetentionExtensionCommands(
      changeFails
        ? {
            ...extension.commands,
            recordRetentionPolicyChange: {
              ...extension.commands.recordRetentionPolicyChange,
              send: async () => {
                throw new Error("event store down");
              },
            },
          }
        : extension.commands,
    );
  }
  const eventsOf = async ({ aggregateId, type }: { aggregateId: string; type: string }) =>
    (
      await eventStore.getEvents({
        aggregateId,
        context: { tenantId: createTenantId(aggregateId) },
        aggregateType: RETENTION_EXTENSION_AGGREGATE_TYPE,
      })
    ).filter((event) => event.type === type);
  const changes = () =>
    eventsOf({ aggregateId: organizationId, type: RETENTION_POLICY_CHANGED_EVENT_TYPE });
  const applied = async () =>
    (
      await Promise.all(
        projectIds.map((projectId) =>
          eventsOf({ aggregateId: projectId, type: RETENTION_APPLIED_EVENT_TYPE }),
        ),
      )
    ).flat();
  return { app, eventing, extension, retroactive, applyStatus, changes, applied };
}

const save = (app: ReturnType<typeof harness>["app"], retentionDays: number) =>
  app.changeScopeRetention({
    organizationId,
    scope: organization,
    category: "traces",
    retentionDays,
    userId: "user-1",
  });

describe("given an organization on a paid plan with two projects", () => {
  describe("when an admin saves 56 days for traces on the organization", () => {
    /** @scenario "Saving a period records the change for its scope" */
    it("records one change naming the scope, the category and the days", async () => {
      const { app, eventing, extension, changes } = harness();
      try {
        await save(app, 56);
        await vi.waitFor(async () => expect(await changes()).toHaveLength(1));
        const [change] = await changes();
        expect(change?.data).toMatchObject({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 56,
        });

        await extension.commands.recordRetentionPolicyChange.send({
          tenantId: organizationId,
          ...retentionPolicyChangedEventDataSchema.parse(change?.data),
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await changes()).toHaveLength(1);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when the save shortens the period", () => {
    /** @scenario "A shorter save records the change but rewrites nothing" */
    it("records the change and rewrites no stored rows", async () => {
      const { app, eventing, retroactive, changes } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
        });
        await save(app, 56);
        await vi.waitFor(async () => expect(await changes()).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(retroactive.raises).toHaveLength(0);
        expect(retroactive.applies).toHaveLength(0);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when recording the change fails", () => {
    /** @scenario "A change that cannot be recorded still saves the rule" */
    it("saves the rule and answers with it", async () => {
      const { app, eventing } = harness({ connected: false });
      try {
        await expect(save(app, 56)).resolves.toMatchObject({
          category: "traces",
          retentionDays: 56,
        });
        await expect(
          app.getRetentionDays({ projectId: retentionTestGraph.projectId, category: "traces" }),
        ).resolves.toBe(56);
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when recording the change fails and the admin applies afterwards", () => {
    /** @scenario "Applying after a change that could not be recorded still says when it was applied" */
    it("reads the organization's scope as applied once every rewrite landed", async () => {
      const { app, eventing, applied, changes } = harness({ changeFails: true });
      const snapshot = () =>
        app.getPolicySnapshot({ projectId: retentionTestGraph.projectId, userId: "user-1" });
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
        });
        await save(app, 56);
        expect(await changes()).toHaveLength(0);
        expect((await snapshot()).storedApply).toEqual([]);

        await app.applyScopeRetentionToStoredData({
          organizationId,
          scope: organization,
          userId: "user-1",
        });
        await vi.waitFor(async () => expect(await applied()).toHaveLength(projectIds.length * 3), {
          timeout: 10_000,
        });
        await vi.waitFor(async () =>
          expect((await snapshot()).storedApply).toEqual([
            expect.objectContaining({ ...organization, status: "applied" }),
          ]),
        );
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when an admin applies the organization's period to stored data", () => {
    /** @scenario "Each project's rewrite records the scope that asked for it" */
    it("names the organization scope on every project's applied fact", async () => {
      const { app, eventing, applied } = harness();
      try {
        await app.applyScopeRetentionToStoredData({
          organizationId,
          scope: organization,
          userId: "user-1",
        });
        await vi.waitFor(async () => expect(await applied()).toHaveLength(projectIds.length * 3), {
          timeout: 10_000,
        });
        expect(
          (await applied()).every(
            (event) =>
              retentionAppliedEventDataSchema.parse(event.data).scope?.scopeId === organizationId,
          ),
        ).toBe(true);
      } finally {
        await eventing.close();
      }
    });

    it("reads the organization's rule as applied once the rewrite landed", async () => {
      const { app, eventing, applied, changes } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 91,
        });
        await save(app, 56);
        await vi.waitFor(async () => expect(await changes()).toHaveLength(1));
        const pending = await app.getPolicySnapshot({
          projectId: retentionTestGraph.projectId,
          userId: "user-1",
        });
        await vi.waitFor(async () =>
          expect(
            (
              await app.getPolicySnapshot({
                projectId: retentionTestGraph.projectId,
                userId: "user-1",
              })
            ).storedApply,
          ).toEqual([expect.objectContaining({ ...organization, status: "pending" })]),
        );
        expect(pending.rules).toHaveLength(1);

        await app.applyScopeRetentionToStoredData({
          organizationId,
          scope: organization,
          userId: "user-1",
        });
        await vi.waitFor(async () => expect(await applied()).toHaveLength(projectIds.length * 3), {
          timeout: 10_000,
        });
        await vi.waitFor(async () =>
          expect(
            (
              await app.getPolicySnapshot({
                projectId: retentionTestGraph.projectId,
                userId: "user-1",
              })
            ).storedApply,
          ).toEqual([expect.objectContaining({ ...organization, status: "applied" })]),
        );
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when a rule was saved before changes were recorded", () => {
    /** @scenario "A rule with no recorded change shows no status" */
    it("names no status for its scope", async () => {
      const { app, eventing } = harness();
      try {
        await app.setForScope({
          organizationId,
          scope: organization,
          category: "traces",
          retentionDays: 56,
        });
        const snapshot = await app.getPolicySnapshot({
          projectId: retentionTestGraph.projectId,
          userId: "user-1",
        });
        expect(snapshot.rules).toHaveLength(1);
        expect(snapshot.storedApply).toEqual([]);
      } finally {
        await eventing.close();
      }
    });
  });
});
