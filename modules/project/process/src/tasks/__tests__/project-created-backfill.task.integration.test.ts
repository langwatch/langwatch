/**
 * @vitest-environment node
 * Re-running backfill-project-created teaches the Instant Evals judge every existing project:
 * the task records through project's own lifecycle pipeline, and the judge's real fold over
 * memory tables learns from it (ADR-174 decisions 15, 17).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { instantEvalJudgeOverMemory } from "@langwatch/instant-eval-judge-process/testing";
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

/** Project's notice and the judge's folds on one eventing; `failCreated` drops a live record. */
function projectBesideJudge() {
  const judge = instantEvalJudgeOverMemory();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const lifecycle = eventing.register(
    buildProjectLifecyclePipeline({ recordProjectCreated: async () => {} }),
  );
  eventing.register(judge.factsPipeline());
  const spend = eventing.register(judge.spendPipeline());
  judge.connectSpend((fact) => spend.commands.recordSpendPriced.send(fact));

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
        await lifecycle.commands.recordProjectCreated.send(payload);
      },
    },
  });
  const taskLogger = { info: vi.fn() };
  const task = ProjectCreatedBackfillTask.create({
    organizations: { findAllIds: async () => [ORGANIZATION, OTHER_ORGANIZATION] },
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
  return { judge, eventing, runTask, loseNextCreated, logger, taskLogger };
}

const JUDGE_CALL = {
  text: "Thanks so much for your help!",
  questions: [{ id: "polite", kind: "boolean", instructions: "Is it polite?" }],
} as const;

describe("ProjectCreatedBackfillTask beside the Instant Evals judge", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  describe("given projects created before the judge existed, and one whose created fact failed", () => {
    describe("when the project catch-up runs twice", () => {
      /** @scenario "The project catch-up teaches the judge every existing project" */
      it("knows each project's organization, and holds each project once", async () => {
        const { judge, eventing, runTask, loseNextCreated, logger } = projectBesideJudge();
        close = () => eventing.close();
        await loseNextCreated({ projectId: "project-lost" });
        expect(logger.error).toHaveBeenCalled();
        expect(judge.rows.projects.size).toBe(0);

        await runTask();
        await runTask();

        await vi.waitFor(() =>
          expect(Object.fromEntries(judge.rows.projects)).toEqual({
            "project-old-1": expect.objectContaining({ organizationId: ORGANIZATION }),
            "project-old-2": expect.objectContaining({ organizationId: ORGANIZATION }),
            "project-lost": expect.objectContaining({ organizationId: ORGANIZATION }),
            "project-beta": expect.objectContaining({ organizationId: OTHER_ORGANIZATION }),
          }),
        );
        expect(judge.rows.projects.size).toBe(4);
      });
    });
  });

  describe("given the judge was just deployed and holds no projects", () => {
    describe("when a judge call arrives for a project created before the deploy", () => {
      /** @scenario "The judge refuses calls until the project catch-up has run, then judges them" */
      it("refuses it as unknown, then classifies the same call once the catch-up has run", async () => {
        const { judge, eventing, runTask } = projectBesideJudge();
        close = () => eventing.close();
        const call = { projectId: "project-old-1", ...JUDGE_CALL };

        const before = await judge.judges.judge(call);
        expect(before).toMatchObject({ outcome: "refused", code: "instant_eval_project_unknown" });

        await runTask();
        await vi.waitFor(() => expect(judge.rows.projects.has("project-old-1")).toBe(true));
        const after = await judge.judges.judge(call);

        expect(after).toMatchObject({
          outcome: "judged",
          judgement: { verdicts: [{ questionId: "polite", probability: 1 }] },
        });
      });
    });
  });

  describe("given four existing projects over two organizations", () => {
    describe("when the project catch-up runs with --dry-run", () => {
      it("records nothing and logs how many projects it would record", async () => {
        const { judge, eventing, runTask, taskLogger } = projectBesideJudge();
        close = () => eventing.close();

        await runTask({ args: ["--dry-run"] });

        expect(taskLogger.info).toHaveBeenCalledWith(
          { isDryRun: true, organizations: 2, projects: 4 },
          expect.any(String),
        );
        // Give a stray fact the time a real one takes to fold, then check none arrived.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(judge.rows.projects.size).toBe(0);
      });
    });

    describe("when it runs for real", () => {
      it("logs the projects it recorded", async () => {
        const { eventing, runTask, taskLogger } = projectBesideJudge();
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
