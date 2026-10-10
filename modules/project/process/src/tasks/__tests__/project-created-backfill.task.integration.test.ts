/**
 * @vitest-environment node
 * Re-running backfill-project-created records every existing project through project's own
 * lifecycle pipeline, which peers such as the Instant Evals judge fold (ADR-174 decisions 15, 17).
 * The judge's fold and refusal are bound in the judge's suite.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProjectLifecyclePipeline } from "../../eventing/project-lifecycle.pipeline.ts";
import type { ProjectRepository } from "../../repositories/project.repository.ts";
import { ProjectCreatedNoticeService } from "../../services/project-created-notice.service.ts";
import { ProjectCreatedBackfillTask } from "../project-created-backfill.task.ts";

const ORGANIZATION = "org-acme";
const OTHER_ORGANIZATION = "org-beta";

const PROJECTS: Readonly<Record<string, string>> = {
  "project-old-1": ORGANIZATION,
  "project-old-2": ORGANIZATION,
  "project-lost": ORGANIZATION,
  "project-beta": OTHER_ORGANIZATION,
};

/** Project's notice over its lifecycle pipeline, recording sends; `failCreated` drops one. */
function projectNotice() {
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
    projects: createApiFixture<
      Pick<ProjectRepository, "findWithOrgAdmin" | "findIdsByOrganization" | "findWithTeam">
    >({
      findIdsByOrganization: async (organizationId) =>
        Object.keys(PROJECTS).filter((id) => PROJECTS[id] === organizationId),
      findWithOrgAdmin: async (id) => {
        const organizationId = PROJECTS[id];
        return organizationId
          ? {
              organizationId,
              adminUserId: "admin-1",
              firstMessage: false,
              onboardingVariant: null,
              organizationCreatedAt: null,
            }
          : null;
      },
    }),
  });
  let failCreated = false;
  notice.connect({
    ...lifecycle.commands,
    recordProjectCreated: {
      send: async (payload) => {
        if (failCreated) throw new Error("event store down");
        recorded.push({ projectId: payload.projectId, organizationId: payload.organizationId });
        await lifecycle.commands.recordProjectCreated.send(payload);
      },
    },
  });
  const taskLogger = { info: vi.fn() };
  const task = ProjectCreatedBackfillTask.create({
    organizations: {
      listAllIds: async () => ({ ids: [ORGANIZATION, OTHER_ORGANIZATION], next: null }),
    },
    projects: { recordExistingProjectsCreated: (input) => notice.recordExisting(input) },
    logger: taskLogger,
  });
  const runTask = ({ args = [] }: { args?: string[] } = {}) =>
    task.run({ args, signal: new AbortController().signal });
  const loseNextCreated = async ({ projectId }: { projectId: string }) => {
    failCreated = true;
    await notice.created({
      projectId,
      organizationId: PROJECTS[projectId]!,
      createdByUserId: null,
      teamId: "team-1",
      isPersonal: false,
    });
    failCreated = false;
  };
  return { eventing, recorded, runTask, loseNextCreated, logger, taskLogger };
}

describe("ProjectCreatedBackfillTask", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given projects created before the judge existed, and one whose created fact failed", () => {
    describe("when the project catch-up runs twice", () => {
      /** @scenario "The project catch-up records every existing project's created fact" */
      it("records each project with its organization, the lost one included", async () => {
        const { eventing, recorded, runTask, loseNextCreated, logger } = projectNotice();
        close = () => eventing.close();
        await loseNextCreated({ projectId: "project-lost" });
        expect(logger.error).toHaveBeenCalled();
        expect(recorded).toEqual([]);

        await runTask();
        await runTask();

        const byProject = Object.fromEntries(
          recorded.map(({ projectId, organizationId }) => [projectId, organizationId]),
        );
        expect(byProject).toEqual({
          "project-old-1": ORGANIZATION,
          "project-old-2": ORGANIZATION,
          "project-lost": ORGANIZATION,
          "project-beta": OTHER_ORGANIZATION,
        });
      });
    });
  });

  describe("given four existing projects over two organizations", () => {
    describe("when the project catch-up runs with --dry-run", () => {
      it("records nothing and logs how many projects it would record", async () => {
        const { eventing, recorded, runTask, taskLogger } = projectNotice();
        close = () => eventing.close();

        await runTask({ args: ["--dry-run"] });

        expect(taskLogger.info).toHaveBeenCalledWith(
          { isDryRun: true, organizations: 2, projects: 4 },
          expect.any(String),
        );
        expect(recorded).toEqual([]);
      });
    });

    describe("when it runs for real", () => {
      it("logs the projects it recorded", async () => {
        const { eventing, runTask, taskLogger } = projectNotice();
        close = () => eventing.close();

        await runTask();

        expect(taskLogger.info).toHaveBeenCalledWith(
          { isDryRun: false, organizations: 2, projects: 4 },
          expect.any(String),
        );
      });
    });
  });
});
