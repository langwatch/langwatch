import { AgentService } from "@langwatch/agent-contract";
import { DatasetService } from "@langwatch/dataset-contract";
import { EvaluatorService } from "@langwatch/evaluator-contract";
import {
  ExperimentNotFoundError,
  type ExperimentService as ExperimentServiceContract,
  type PersistedEvaluationsV3State,
} from "@langwatch/experiment-contract";
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
const namespace = `experiment-workbench-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let otherProjectId = "";

const database = (): PrismaClient => {
  if (!connection)
    throw new Error("DATABASE_URL is required for Experiment workbench persistence tests");
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
  });

const state = (
  name: string,
  results?: PersistedEvaluationsV3State["results"],
): PersistedEvaluationsV3State => ({
  name,
  datasets: [
    {
      id: "dataset_1",
      name: "Inline",
      type: "inline",
      columns: [{ id: "input", name: "input", type: "string" }],
    },
  ],
  activeDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
  ...(results ? { results } : {}),
});

const handledCode = async (operation: Promise<unknown>): Promise<string | null> => {
  try {
    await operation;
    return null;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : null;
  }
};

describe.skipIf(!databaseUrl)("Experiment workbench persistence", () => {
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

  it("keeps one rolling autosave, pages named history, and restores setup with live results", async () => {
    const experiments = service();
    const created = await experiments.createEvaluationsV3({
      projectId,
      state: state("Original"),
      actor: { label: "user" },
    });
    const typed = await experiments.saveWorkbenchState({
      projectId,
      id: created.experimentId,
      state: state("Typed"),
      expectedVersion: created.version,
      actor: { label: "user" },
    });
    const committed = await experiments.commitWorkbenchVersion({
      projectId,
      id: created.experimentId,
      commitMessage: "Baseline",
      actor: { label: "user" },
    });
    const withResults = await experiments.saveWorkbenchState({
      projectId,
      id: created.experimentId,
      expectedVersion: committed.version,
      actor: { label: "user" },
      state: state("Changed", {
        runId: "run_1",
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      }),
    });
    const firstPage = await experiments.listWorkbenchVersions({
      projectId,
      id: created.experimentId,
      limit: 1,
    });
    expect(firstPage.versions).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const history = await database().experimentVersion.findMany({
      where: { projectId, experimentId: created.experimentId },
      orderBy: { counterVersion: "asc" },
    });
    expect(history.filter((version) => version.autoSaved)).toHaveLength(1);
    await experiments.restoreWorkbenchVersion({
      projectId,
      id: created.experimentId,
      version: created.version,
      actor: { label: "user" },
    });
    const restored = await experiments.getWorkbenchState({ projectId, id: created.experimentId });
    expect(restored.state?.name).toBe("Original");
    expect(restored.state?.results?.runId).toBe("run_1");
    expect(withResults.version).toBeGreaterThan(typed.version);
  });

  it("refuses stale concurrent CAS writes with currentVersion metadata", async () => {
    const experiments = service();
    const created = await experiments.createEvaluationsV3({
      projectId,
      state: state("Original"),
      actor: { label: "user" },
    });
    const writes = await Promise.all([
      handledCode(
        experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("A"),
          expectedVersion: created.version,
          actor: { label: "user" },
        }),
      ),
      handledCode(
        experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("B"),
          expectedVersion: created.version,
          actor: { label: "langy" },
        }),
      ),
    ]);
    expect(writes.filter((code) => code === null)).toHaveLength(1);
    expect(writes.filter((code) => code === "experiment_stale_workbench_state")).toHaveLength(1);
  });

  it("does not disclose or mutate archived and cross-project workbenches", async () => {
    const experiments = service();
    const created = await experiments.createEvaluationsV3({
      projectId,
      state: state("Private"),
      actor: { label: "user" },
    });
    await experiments.archive({ projectId, id: created.experimentId });
    expect(
      await handledCode(experiments.getWorkbenchState({ projectId, id: created.experimentId })),
    ).toBe("experiment_not_found");
    const foreign = await experiments.createEvaluationsV3({
      projectId: otherProjectId,
      state: state("Other"),
      actor: { label: "user" },
    });
    expect(
      await handledCode(experiments.getWorkbenchState({ projectId, id: foreign.experimentId })),
    ).toBe("experiment_not_found");
  });
});
