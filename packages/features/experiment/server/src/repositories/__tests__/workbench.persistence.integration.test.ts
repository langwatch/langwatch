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
import { UnavailableExperimentExecutionAdapter } from "../../adapters/unavailable-experiment-execution.adapter";
import { NoopExperimentWorkbenchUpdatesAdapter } from "../../adapters/noop-experiment-workbench-updates.adapter";

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
    execution: UnavailableExperimentExecutionAdapter.create(),
    updates: NoopExperimentWorkbenchUpdatesAdapter.create(),
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

  describe("given an evaluation someone else already saved on top of", () => {
    describe("when a save names the version it read before that", () => {
      /** @scenario A save that names an old version is refused before anything is written */
      it("refuses the save and leaves the stored state untouched", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Winner"),
          expectedVersion: created.version,
          actor: { label: "user" },
        });
        const before = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });

        expect(
          await handledCode(
            experiments.saveWorkbenchState({
              projectId,
              id: created.experimentId,
              state: state("Loser"),
              expectedVersion: created.version,
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_stale_workbench_state");

        const after = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(after.workbenchVersion).toBe(before.workbenchVersion);
        expect(after.workbenchState).toEqual(before.workbenchState);
      });

      /** @scenario A refusal names the run that wrote the newer version */
      it("names the run when a run wrote the newer version", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Results from the run"),
          expectedVersion: created.version,
          actor: { label: "user", runId: "bold-jolly-bee" },
        });

        try {
          await experiments.saveWorkbenchState({
            projectId,
            id: created.experimentId,
            state: state("The reader's own edit"),
            expectedVersion: created.version,
            actor: { label: "user" },
          });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          const meta = HandledError.isHandled(error) ? error.meta : {};
          expect(meta).toEqual({
            currentVersion: created.version + 1,
            actorLabel: "user",
            runId: "bold-jolly-bee",
          });
        }
      });
    });
  });

  describe("given a save that names no expected version", () => {
    describe("when it is accepted", () => {
      /** @scenario A save with no expected version advances the counter */
      it("advances the stored version by one", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        const saved = await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Next"),
          actor: { label: "user" },
        });

        expect(saved.version).toBe(created.version + 1);
        const row = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(row.workbenchVersion).toBe(created.version + 1);
      });
    });
  });

  describe("given a person typing for a while", () => {
    describe("when several saves land with no commit message", () => {
      /** @scenario Repeated typing keeps a single rolling autosave row */
      it("keeps exactly one autosaved row, at the current version", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        for (const label of ["one", "two", "three"]) {
          await experiments.saveWorkbenchState({
            projectId,
            id: created.experimentId,
            state: state(label),
            actor: { label: "user" },
          });
        }

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
          orderBy: { version: "asc" },
        });
        const autoSaved = rows.filter((row) => row.autoSaved);
        expect(autoSaved).toHaveLength(1);

        const experiment = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(autoSaved[0]?.version).toBe(experiment.workbenchVersion);
        expect(autoSaved[0]?.counterVersion).toBe(experiment.workbenchVersion);
      });
    });
  });

  describe("given an evaluation committed, typed on and committed again", () => {
    const typeThenCommitTwice = async (experiments: ExperimentServiceContract) => {
      const created = await experiments.createEvaluationsV3({
        projectId,
        state: state("Original"),
        actor: { label: "user" },
      });
      await experiments.commitWorkbenchVersion({
        projectId,
        id: created.experimentId,
        commitMessage: "First",
        actor: { label: "user" },
      });

      for (const label of ["one", "two", "three", "four", "five"]) {
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state(label),
          actor: { label: "user" },
        });
      }

      await experiments.commitWorkbenchVersion({
        projectId,
        id: created.experimentId,
        commitMessage: "Second",
        actor: { label: "user" },
      });

      return created.experimentId;
    };

    describe("when the numbered versions are read", () => {
      /** @scenario "Typing between two commits leaves no gap in the numbers" */
      it("numbers them 1, 2, 3 however many autosaves land between", async () => {
        const experiments = service();
        const experimentId = await typeThenCommitTwice(experiments);

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId },
          orderBy: { version: "asc" },
        });
        expect(rows.filter((row) => !row.autoSaved).map((row) => row.version)).toEqual([1, 2, 3]);
      });
    });

    describe("when the versions are listed", () => {
      /** @scenario "The newest version is the one written last" */
      it("puts the second commit first and the autosave under it", async () => {
        const experiments = service();
        const experimentId = await typeThenCommitTwice(experiments);

        const { versions } = await experiments.listWorkbenchVersions({
          projectId,
          id: experimentId,
        });

        expect(
          versions.map((entry) => (entry.autoSaved ? "autosave" : `v${entry.version}`)),
        ).toEqual(["v3", "autosave", "v2", "v1"]);
        expect(versions[0]?.commitMessage).toBe("Second");
        expect(versions[2]?.commitMessage).toBe("First");
      });
    });
  });

  describe("given a version history holding an autosave", () => {
    describe("when the autosave row is restored", () => {
      /** @scenario "A restore of the autosave says so instead of naming a number" */
      it("names the autosave rather than a number no reader can see", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Typed, never committed"),
          actor: { label: "user" },
        });
        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
          orderBy: { version: "asc" },
        });
        const autoSaved = rows.find((row) => row.autoSaved);

        const restored = await experiments.restoreWorkbenchVersion({
          projectId,
          id: created.experimentId,
          version: autoSaved?.version ?? 0,
          actor: { label: "user" },
        });

        const written = await database().experimentVersion.findFirstOrThrow({
          where: {
            projectId,
            experimentId: created.experimentId,
            counterVersion: restored.version,
          },
        });
        expect(written.commitMessage).toBe("Restored from the autosave");
      });
    });
  });

  describe("given a commit landing straight after one autosave", () => {
    describe("when the version rows are read", () => {
      /** @scenario "The autosave row and the numbered versions never take the same number" */
      it("keeps the autosave row on a number of its own", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Typed once"),
          actor: { label: "user" },
        });
        await experiments.commitWorkbenchVersion({
          projectId,
          id: created.experimentId,
          commitMessage: "Straight after",
          actor: { label: "user" },
        });

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
          orderBy: { version: "asc" },
        });
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((row) => row.version)).size).toBe(3);
        expect(rows.filter((row) => !row.autoSaved).map((row) => row.version)).toEqual([1, 2]);

        const experiment = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(rows.find((row) => row.autoSaved)?.version).toBe(experiment.workbenchVersion);
      });
    });
  });

  describe("given a caller committing a named version", () => {
    describe("when the commit is accepted", () => {
      /** @scenario A commit creates a numbered version with its message */
      it("adds a numbered row carrying the message", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Edited"),
          actor: { label: "user" },
        });

        const committed = await experiments.commitWorkbenchVersion({
          projectId,
          id: created.experimentId,
          commitMessage: "Ready for review",
          actor: { label: "user" },
        });

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
        });
        const commit = rows.find((row) => row.counterVersion === committed.version);
        expect(commit?.autoSaved).toBe(false);
        expect(commit?.commitMessage).toBe("Ready for review");
      });
    });
  });

  describe("given the assistant writing on a user's behalf", () => {
    describe("when it saves through the seam", () => {
      /** @scenario An assistant write is recorded as its own version */
      it("adds a numbered row attributed to the assistant", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        const saved = await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Written by the assistant"),
          actor: { label: "langy" },
        });

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
        });
        const written = rows.find((row) => row.counterVersion === saved.version);
        expect(written?.autoSaved).toBe(false);
        expect(written?.authorLabel).toBe("langy");
      });
    });
  });

  describe("given an evaluation with an earlier version", () => {
    describe("when that version is restored", () => {
      /** @scenario A restore writes the old state forward */
      it("writes the old state forward and keeps the history", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        const first = await experiments.commitWorkbenchVersion({
          projectId,
          id: created.experimentId,
          commitMessage: "The one to come back to",
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("Something else"),
          actor: { label: "user" },
        });

        const restored = await experiments.restoreWorkbenchVersion({
          projectId,
          id: created.experimentId,
          version: first.version,
          actor: { label: "user" },
        });

        expect(restored.version).toBeGreaterThan(first.version);

        const current = await experiments.getWorkbenchState({
          projectId,
          id: created.experimentId,
        });
        const original = await database().experimentVersion.findFirstOrThrow({
          where: { projectId, experimentId: created.experimentId, version: first.version },
        });
        expect(current.state?.name).toBe((original.state as { name: string }).name);

        const rows = await database().experimentVersion.findMany({
          where: { projectId, experimentId: created.experimentId },
        });
        expect(rows.map((row) => row.version)).toContain(first.version);
        expect(rows.find((row) => row.counterVersion === restored.version)?.commitMessage).toBe(
          `Restored from v${first.version}`,
        );
      });
    });
  });

  describe("given an evaluation with an earlier version and a completed run", () => {
    describe("when that version is restored", () => {
      /** @scenario A restore keeps the current run's results */
      it("brings the old setup back and keeps the run's cells", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        const earlier = await experiments.commitWorkbenchVersion({
          projectId,
          id: created.experimentId,
          commitMessage: "The setup to come back to",
          actor: { label: "user" },
        });
        const earlierName = (
          await experiments.getWorkbenchState({ projectId, id: created.experimentId })
        ).state?.name;

        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("A setup nobody wants"),
          actor: { label: "user" },
        });
        await experiments.saveWorkbenchState({
          projectId,
          id: created.experimentId,
          state: state("A setup nobody wants", {
            runId: "run_1",
            targetOutputs: { target_1: [{ output: "what the run said" }] },
            targetMetadata: {},
            evaluatorResults: {},
            errors: {},
          }),
          actor: { label: "api" },
          commitMessage: "Results from run run_1",
        });

        await experiments.restoreWorkbenchVersion({
          projectId,
          id: created.experimentId,
          version: earlier.version,
          actor: { label: "user" },
        });

        const current = await experiments.getWorkbenchState({
          projectId,
          id: created.experimentId,
        });
        expect(current.state?.name).toBe(earlierName);
        expect(current.state?.results?.targetOutputs.target_1).toEqual([
          { output: "what the run said" },
        ]);
        expect(current.state?.results?.runId).toBe("run_1");
      });
    });
  });

  describe("given two saves of the same evaluation that both read one version", () => {
    describe("when they race in the database", () => {
      /** @scenario Two saves that race are not both accepted */
      it("accepts one and refuses the other as stale", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        const attempt = async (name: string) => {
          try {
            await experiments.saveWorkbenchState({
              projectId,
              id: created.experimentId,
              state: state(name),
              actor: { label: "user" },
            });
            return { name, code: "no_error" };
          } catch (error) {
            return {
              name,
              code: HandledError.isHandled(error) ? error.code : "not_handled",
            };
          }
        };

        const outcomes = await Promise.all([attempt("Writer A"), attempt("Writer B")]);
        const accepted = outcomes.filter((one) => one.code === "no_error");
        const refused = outcomes.filter((one) => one.code === "experiment_stale_workbench_state");
        expect(accepted).toHaveLength(1);
        expect(refused).toHaveLength(1);

        const row = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect((row.workbenchState as { name: string }).name).toBe(accepted[0]?.name);
        expect(row.workbenchVersion).toBe(created.version + 1);
      });

      /** @scenario A refusal names the version the server holds now */
      it("tells the refused writer the version the winner created", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });

        const attempt = async (name: string) => {
          try {
            await experiments.saveWorkbenchState({
              projectId,
              id: created.experimentId,
              state: state(name),
              actor: { label: "user" },
            });
            return { code: "no_error", meta: {} as Record<string, unknown> };
          } catch (error) {
            return {
              code: HandledError.isHandled(error) ? error.code : "not_handled",
              meta: HandledError.isHandled(error) ? (error.meta ?? {}) : {},
            };
          }
        };

        const outcomes = await Promise.all([attempt("Writer A"), attempt("Writer B")]);
        const refused = outcomes.find((one) => one.code === "experiment_stale_workbench_state");
        expect(refused?.meta).toEqual({
          currentVersion: created.version + 1,
          actorLabel: "user",
        });
      });
    });
  });

  describe("given an evaluation whose counter moved without a version row", () => {
    describe("when the workbench state is read", () => {
      /** @scenario "A version with no row of its own names nobody" */
      it("names nobody, rather than the author of the older version", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        expect(
          (await experiments.getWorkbenchState({ projectId, id: created.experimentId })).actorLabel,
        ).toBe("user");

        await database().experiment.updateMany({
          where: { id: created.experimentId, projectId },
          data: { workbenchVersion: { increment: 1 } },
        });

        const view = await experiments.getWorkbenchState({ projectId, id: created.experimentId });
        expect(view.actorLabel).toBeUndefined();
      });
    });
  });

  describe("given an archived evaluation", () => {
    describe("when a stale client saves with its id", () => {
      /** @scenario An archived evaluation refuses a save */
      it("refuses as not found and leaves the archived row alone", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        await experiments.archive({ projectId, id: created.experimentId });

        const archived = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });

        expect(
          await handledCode(
            experiments.saveWorkbenchState({
              projectId,
              id: created.experimentId,
              state: state("Stale autosave"),
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_not_found");

        const after = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId },
        });
        expect(after.workbenchVersion).toBe(archived.workbenchVersion);
        expect(after.workbenchState).toEqual(archived.workbenchState);
      });
    });
  });

  describe("given an evaluation that belongs to another project", () => {
    describe("when a caller saves it naming its own project", () => {
      /** @scenario A save cannot reach another project's evaluation */
      it("refuses as not found and never touches the other project's row", async () => {
        const experiments = service();
        const created = await experiments.createEvaluationsV3({
          projectId: otherProjectId,
          state: state("Original"),
          actor: { label: "user" },
        });
        const before = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId: otherProjectId },
        });

        expect(
          await handledCode(
            experiments.saveWorkbenchState({
              projectId,
              id: created.experimentId,
              state: state("Not yours"),
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_not_found");

        const after = await database().experiment.findFirstOrThrow({
          where: { id: created.experimentId, projectId: otherProjectId },
        });
        expect(after.workbenchVersion).toBe(before.workbenchVersion);
        expect(after.workbenchState).toEqual(before.workbenchState);
      });
    });
  });
});
