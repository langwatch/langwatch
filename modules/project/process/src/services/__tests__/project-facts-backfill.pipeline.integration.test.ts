/**
 * @vitest-environment node
 * A run of project:record-created-facts records every existing project through project's own
 * lifecycle pipeline, which peers such as the Instant Evals judge fold (ADR-174 decisions 15, 17).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProjectLifecyclePipeline } from "../../eventing/project-lifecycle.pipeline.ts";
import type { ProjectBackfillRow } from "../../repositories/project.repository.ts";
import { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";
import { ProjectFactsBackfillService } from "../project-facts-backfill.service.ts";

const ORGANIZATION = "org-acme";
const OTHER_ORGANIZATION = "org-beta";

const PROJECTS: Readonly<Record<string, string>> = {
  "project-beta": OTHER_ORGANIZATION,
  "project-lost": ORGANIZATION,
  "project-old-1": ORGANIZATION,
  "project-old-2": ORGANIZATION,
};

const rows: ProjectBackfillRow[] = Object.entries(PROJECTS).map(([id, organizationId]) => ({
  id,
  createdAt: fromDate(new Date("2025-01-01T00:00:00.000Z")),
  organizationId,
  teamId: "team-1",
  isPersonal: false,
  departmentId: null,
  presenceEnabled: true,
  isArchived: false,
  adminUserId: "admin-1",
}));

/** The step over project's lifecycle pipeline; `loseNextCreated` drops one created fact. */
function factsStep() {
  const recorded: { projectId: string; organizationId: string }[] = [];
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const lifecycle = eventing.register(
    buildProjectLifecyclePipeline({
      recordProjectCreated: async () => {},
      personalProjects: {
        create: async () => "project_personal",
        archive: async () => {},
        revive: async () => {},
        setFeatures: async () => {},
      },
    }),
  );
  const logger = { error: vi.fn() };
  const notice = ProjectCreatedNoticeService.create({
    logger,
    projects: {
      findWithTeam: async () => null,
      findWithOrgAdmin: async (id) => ({
        organizationId: PROJECTS[id] ?? null,
        adminUserId: "admin-1",
        firstMessage: false,
        onboardingVariant: null,
        organizationCreatedAt: null,
      }),
    },
  });
  let failCreated = false;
  const created = lifecycle.commands.recordProjectCreated;
  notice.connect({
    ...lifecycle.commands,
    recordProjectCreated: {
      send: async (payload) => {
        if (failCreated) throw new Error("event store down");
        await created.send(payload);
      },
      sendBatch: async (payloads) => {
        recorded.push(
          ...payloads.map(({ projectId, organizationId }) => ({ projectId, organizationId })),
        );
        await created.sendBatch(payloads);
      },
    },
  });
  const step = ProjectFactsBackfillService.create({
    projects: {
      listBackfillPage: async ({ afterId, limit }) => {
        const projects = rows.filter((row) => afterId === null || row.id > afterId).slice(0, limit);
        return { projects, orphanIds: [], lastId: projects.at(-1)?.id ?? null };
      },
    },
    lifecycle: notice,
    logger: createTestLogger().logger,
  });
  const runStep = () =>
    step.recordExisting({
      dryRun: false,
      signal: new AbortController().signal,
      afterProjectId: null,
      countedBefore: {
        projects: 0,
        departmentAssignments: 0,
        presenceSettings: 0,
        skippedOrphans: 0,
        orphanProjectIds: [],
      },
      onPageDone: async () => {},
    });
  const loseNextCreated = async ({ projectId }: { projectId: string }) => {
    failCreated = true;
    await notice.created({
      projectId,
      organizationId: PROJECTS[projectId] ?? ORGANIZATION,
      createdByUserId: null,
      teamId: "team-1",
      isPersonal: false,
    });
    failCreated = false;
  };
  return { eventing, recorded, runStep, loseNextCreated, logger };
}

describe("given projects created before the judge existed, and one whose created fact failed", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("when the project facts step runs twice", () => {
    /** @scenario "The project catch-up records every existing project's created fact" */
    it("records each project with its organization, the lost one included", async () => {
      const { eventing, recorded, runStep, loseNextCreated, logger } = factsStep();
      close = () => eventing.close();
      await loseNextCreated({ projectId: "project-lost" });
      expect(logger.error).toHaveBeenCalled();
      expect(recorded).toEqual([]);

      await runStep();
      await runStep();

      expect(
        Object.fromEntries(recorded.map((fact) => [fact.projectId, fact.organizationId])),
      ).toEqual(PROJECTS);
    });
  });
});
