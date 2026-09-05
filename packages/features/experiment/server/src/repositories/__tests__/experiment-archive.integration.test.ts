import { DatasetService } from "@langwatch/dataset-contract";
import { AgentService } from "@langwatch/agent-contract";
import { EvaluatorService } from "@langwatch/evaluator-contract";
import { type ExperimentService as ExperimentServiceContract } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { PromptService } from "@langwatch/prompt-contract";
import { WorkflowService } from "@langwatch/workflow-contract";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExperimentDspyRepository } from "../experiment-dspy.repository";
import { ExperimentRunRepository } from "../experiment-run.repository";
import { PrismaExperimentRepository } from "../prisma/prisma.experiment.repository";
import { ExperimentService } from "../../services/experiment.service";
import { UnavailableExperimentExecutionAdapter } from "../../adapters/unavailable-experiment-execution.adapter";
import { NoopExperimentWorkbenchUpdatesAdapter } from "../../adapters/noop-experiment-workbench-updates.adapter";

/**
 * The Postgres half of archiving: what `archiveActive` actually leaves behind. The cascade into a backing workflow and monitor is covered by
 * `app/__tests__/experiment.app.unit.test.ts` against a stubbed repository, since that cascade lives in `ExperimentApp`, not this repository.
 * @see specs/experiments-v3/experiment-archive.feature
 */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const namespace = `experiment-archive-${randomUUID()}`;
let teamId = "";
let organizationId = "";
let projectId = "";
let otherProjectId = "";

const database = (): PrismaClient => {
  if (!connection) throw new Error("DATABASE_URL is required for Experiment archive tests");
  return connection.client;
};

const references = {
  prompts: Object.create(PromptService.prototype) as PromptService,
  agents: Object.create(AgentService.prototype) as AgentService,
  evaluators: Object.create(EvaluatorService.prototype) as EvaluatorService,
  workflows: Object.create(WorkflowService.prototype) as WorkflowService,
  dataset: Object.create(DatasetService.prototype) as DatasetService,
};

const service = (): ExperimentServiceContract =>
  ExperimentService.create({
    repository: PrismaExperimentRepository.create(database()),
    runRepository: Object.create(ExperimentRunRepository.prototype) as ExperimentRunRepository,
    dspyRepository: Object.create(ExperimentDspyRepository.prototype) as ExperimentDspyRepository,
    slugify: (value) =>
      value
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-|-$/g, ""),
    newId: () => `experiment_${randomUUID()}`,
    references,
    execution: UnavailableExperimentExecutionAdapter.create(),
    updates: NoopExperimentWorkbenchUpdatesAdapter.create(),
  });

const state = (name: string) => ({
  name,
  datasets: [
    {
      id: "dataset_1",
      name: "Inline",
      type: "inline" as const,
      columns: [{ id: "input", name: "input", type: "string" }],
    },
  ],
  activeDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
});

const handledCode = async (operation: Promise<unknown>): Promise<string | null> => {
  try {
    await operation;
    return null;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : null;
  }
};

describe.skipIf(!databaseUrl)("Experiment archive persistence", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    const projects = await Promise.all(
      ["main", "other"].map((suffix) =>
        db.project.create({
          data: {
            name: `${namespace}-${suffix}`,
            slug: `${namespace}-${suffix}`,
            apiKey: `${namespace}-${suffix}`,
            teamId,
            language: "typescript",
            framework: "other",
          },
        }),
      ),
    );
    projectId = projects[0]!.id;
    otherProjectId = projects[1]!.id;
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["experimentVersion", { projectId: { in: [projectId, otherProjectId] } }],
      ["experiment", { projectId: { in: [projectId, otherProjectId] } }],
    ]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["experimentVersion", { projectId: { in: [projectId, otherProjectId] } }],
          ["experiment", { projectId: { in: [projectId, otherProjectId] } }],
          ["project", { id: { in: [projectId, otherProjectId] } }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given an unarchived experiment", () => {
    describe("when the caller archives it", () => {
      /** @scenario Archiving an experiment sets archivedAt and preserves the row */
      it("preserves the row and stamps archivedAt", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        await experiments.archive({ projectId, id: created.experimentId });

        const row = await database().experiment.findFirst({
          where: { id: created.experimentId, projectId },
        });
        expect(row).not.toBeNull();
        expect(row?.archivedAt).not.toBeNull();
        expect(row!.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
        expect(row?.slug).toMatch(/-archived-/);
      });
    });
  });

  describe("given an archived experiment", () => {
    describe("when the caller archives it a second time", () => {
      /** @scenario A second click on the same already-archived experiment is a no-op */
      it("does not overwrite the original archivedAt timestamp", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.archive({ projectId, id: created.experimentId });
        const first = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        await experiments.archive({ projectId, id: created.experimentId });

        const after = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(after.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
      });
    });

    describe("when the caller reads it by id", () => {
      /** @scenario A single getExperiment by id returns archived experiments as not-found */
      it("answers not found", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.archive({ projectId, id: created.experimentId });

        expect(
          await handledCode(experiments.getById({ projectId, id: created.experimentId })),
        ).toBe("experiment_not_found");
      });
    });
  });

  describe("given a project with one live and one archived experiment", () => {
    describe("when the caller lists experiments", () => {
      /** @scenario Archived experiments are hidden from the standard list query */
      it("returns only the live experiment", async () => {
        const experiments = service();
        const live = await experiments.createEvaluationsV3({
          projectId,
          state: state("Live"),
          actor: { label: "user" },
        });
        const archived = await experiments.createEvaluationsV3({
          projectId,
          state: state("Archived"),
          actor: { label: "user" },
        });
        await experiments.archive({ projectId, id: archived.experimentId });

        const list = await experiments.list({ projectId });

        expect(list.map((entry) => entry.id)).toContain(live.experimentId);
        expect(list.map((entry) => entry.id)).not.toContain(archived.experimentId);
      });
    });
  });

  describe("given an experiment that belongs to another project", () => {
    describe("when the caller archives it naming its own project", () => {
      /** @scenario An experiment from another project cannot be archived */
      it("refuses as not found and leaves the other project's row untouched", async () => {
        const experiments = service();
        const foreign = await experiments.createEvaluationsV3({
          projectId: otherProjectId,
          state: state("Foreign"),
          actor: { label: "user" },
        });

        expect(
          await handledCode(experiments.archive({ projectId, id: foreign.experimentId })),
        ).toBe("experiment_not_found");

        const row = await database().experiment.findFirst({
          where: { id: foreign.experimentId, projectId: otherProjectId },
        });
        expect(row?.archivedAt).toBeNull();
      });
    });
  });
});
