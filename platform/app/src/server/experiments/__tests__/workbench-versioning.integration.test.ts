/**
 * Integration tests for the versioned workbench write seam against real
 * Postgres. They exist to prove the parts a mocked repository cannot: that the
 * compare-and-set really refuses a racing write, that exactly one rolling
 * autosave row survives a long editing session, and that a restore adds to the
 * history instead of rewriting it while keeping the current run's cells.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Prisma, Project } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { ExperimentRepository } from "../experiment.repository";
import { ExperimentService } from "../experiment.service";
import { WorkbenchReferenceRepository } from "../workbenchReference.repository";

const TARGET_ID = "target-1";

const stateNamed = (name: string): PersistedEvaluationsV3State =>
  ({
    name,
    datasets: [
      {
        id: "dataset-1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset-1",
    evaluators: [],
    targets: [],
  }) as PersistedEvaluationsV3State;

/** What a completed run leaves on the live row. */
const runResults = (
  output: string,
): PersistedEvaluationsV3State["results"] => ({
  runId: "run_1",
  targetOutputs: { [TARGET_ID]: [{ output }] },
  targetMetadata: { [TARGET_ID]: [{ traceId: "trace-0" }] },
  evaluatorResults: {},
  errors: {},
});

const stateWithResults = (
  name: string,
  output: string,
): PersistedEvaluationsV3State => ({
  ...stateNamed(name),
  results: runResults(output),
});

/**
 * The real repository, with a gate between the transactional read and the
 * compare-and-set update.
 *
 * Holding one writer there while the other reads is what makes both of them
 * name the same stored version. That interleaving is what the pre-check cannot
 * catch, because both writers read the same number and only the database can
 * tell which of them wrote first.
 */
class GatedExperimentRepository extends ExperimentRepository {
  constructor(
    prismaClient: typeof prisma,
    private readonly onTransactionalRead: () => Promise<void>,
  ) {
    super(prismaClient);
  }

  override async findWorkbenchRow(
    input: { projectId: string; id?: string; slug?: string },
    options?: { tx?: Prisma.TransactionClient },
  ) {
    const row = await super.findWorkbenchRow(input, options);
    if (options?.tx) await this.onTransactionalRead();
    return row;
  }
}

const gatedService = (onTransactionalRead: () => Promise<void>) =>
  new ExperimentService(
    new GatedExperimentRepository(prisma, onTransactionalRead),
    new WorkbenchReferenceRepository(prisma),
  );

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not_handled";
  }
  return "no_error";
};

describe("workbench versioning", () => {
  let project: Project;
  let otherProject: Project;
  let service: ExperimentService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("workbench-versioning");
    otherProject = await getTestProject("workbench-versioning-other");
    service = ExperimentService.create({ prisma });
  });

  afterAll(async () => {
    for (const projectId of [project.id, otherProject.id]) {
      await prisma.experimentVersion.deleteMany({
        where: { experimentId: { in: createdIds }, projectId },
      });
      await prisma.experiment.deleteMany({
        where: { id: { in: createdIds }, projectId },
      });
    }
  });

  const createEvaluation = async (
    projectId: string = project.id,
  ): Promise<{ experimentId: string; version: number }> => {
    const created = await service.createEvaluationsV3({
      projectId,
      state: stateNamed(`Workbench ${nanoid(6)}`),
      actor: { label: "user" },
    });
    createdIds.push(created.experimentId);
    return { experimentId: created.experimentId, version: created.version };
  };

  const versionRows = async (experimentId: string) =>
    await prisma.experimentVersion.findMany({
      where: { experimentId, projectId: project.id },
      orderBy: { version: "asc" },
    });

  describe("given an evaluation someone else already saved on top of", () => {
    describe("when a save names the version it read before that", () => {
      /** @scenario A save that names an old version is refused before anything is written */
      it("refuses the save and leaves the stored state untouched", async () => {
        const { experimentId, version } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Winner"),
          expectedVersion: version,
          actor: { label: "user" },
        });

        const before = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });

        expect(
          await codeOf(
            service.saveWorkbenchState({
              projectId: project.id,
              id: experimentId,
              state: stateNamed("Loser"),
              expectedVersion: version,
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_stale_workbench_state");

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect(after.workbenchVersion).toBe(before.workbenchVersion);
        expect(after.workbenchState).toEqual(before.workbenchState);
      });

      it("reports the version the caller has to reload to", async () => {
        const { experimentId, version } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Winner"),
          expectedVersion: version,
          actor: { label: "user" },
        });

        try {
          await service.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateNamed("Loser"),
            expectedVersion: version,
            actor: { label: "user" },
          });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          const meta = HandledError.isHandled(error) ? error.meta : {};
          expect(meta).toEqual({
            currentVersion: version + 1,
            actorLabel: "user",
          });
        }
      });

      /** @scenario "A refused save names who holds the newer version" */
      it("names Langy when Langy wrote the newer version", async () => {
        const { experimentId, version } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Langy's candidate"),
          expectedVersion: version,
          actor: { label: "langy" },
        });

        try {
          await service.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateNamed("The reader's own edit"),
            expectedVersion: version,
            actor: { label: "user" },
          });
          expect.unreachable("the save should have been refused");
        } catch (error) {
          const meta = HandledError.isHandled(error) ? error.meta : {};
          expect(meta).toEqual({
            currentVersion: version + 1,
            actorLabel: "langy",
          });
        }
      });
    });
  });

  describe("given a save that names no expected version", () => {
    describe("when it is accepted", () => {
      /** @scenario A save with no expected version advances the counter */
      it("advances the stored version by one", async () => {
        const { experimentId, version } = await createEvaluation();

        const saved = await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Next"),
          actor: { label: "user" },
        });

        expect(saved.version).toBe(version + 1);
        const row = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect(row.workbenchVersion).toBe(version + 1);
      });
    });
  });

  describe("given a person typing for a while", () => {
    describe("when several saves land with no commit message", () => {
      /** @scenario Repeated typing keeps a single rolling autosave row */
      it("keeps exactly one autosaved row, at the current version", async () => {
        const { experimentId } = await createEvaluation();

        for (const label of ["one", "two", "three"]) {
          await service.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateNamed(label),
            actor: { label: "user" },
          });
        }

        const rows = await versionRows(experimentId);
        const autoSaved = rows.filter((row) => row.autoSaved);
        expect(autoSaved).toHaveLength(1);

        const experiment = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect(autoSaved[0]?.version).toBe(experiment.workbenchVersion);
        // The row was rewritten by the last of those saves, so it is the state
        // the experiment holds now and the list has to sort it first.
        expect(autoSaved[0]?.counterVersion).toBe(experiment.workbenchVersion);
      });
    });
  });

  describe("given an evaluation committed, typed on and committed again", () => {
    const typeThenCommitTwice = async () => {
      const { experimentId } = await createEvaluation();
      const first = await service.commitWorkbenchVersion({
        projectId: project.id,
        id: experimentId,
        commitMessage: "First",
        actor: { label: "user" },
      });

      for (const label of ["one", "two", "three", "four", "five"]) {
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed(label),
          actor: { label: "user" },
        });
      }

      const second = await service.commitWorkbenchVersion({
        projectId: project.id,
        id: experimentId,
        commitMessage: "Second",
        actor: { label: "user" },
      });

      return { experimentId, first, second };
    };

    describe("when the numbered versions are read", () => {
      /** @scenario "Typing between two commits leaves no gap in the numbers" */
      it("numbers them 1, 2, 3 however many autosaves land between", async () => {
        const { experimentId } = await typeThenCommitTwice();

        const rows = await versionRows(experimentId);
        expect(
          rows.filter((row) => !row.autoSaved).map((row) => row.version),
        ).toEqual([1, 2, 3]);
      });
    });

    describe("when the versions are listed", () => {
      /** @scenario "The newest version is the one written last" */
      it("puts the second commit first and the autosave under it", async () => {
        const { experimentId } = await typeThenCommitTwice();

        const { versions } = await service.listWorkbenchVersions({
          projectId: project.id,
          id: experimentId,
        });

        // The history as a reader sees it: the autosave carries no number of
        // its own, and the numbered versions run down without a gap.
        expect(
          versions.map((entry) =>
            entry.autoSaved ? "autosave" : `v${entry.version}`,
          ),
        ).toEqual(["v3", "autosave", "v2", "v1"]);
        expect(versions[0]?.commitMessage).toBe("Second");
        expect(versions[2]?.commitMessage).toBe("First");
      });

      it("pages through the whole history without repeating a row", async () => {
        const { experimentId } = await typeThenCommitTwice();

        const firstPage = await service.listWorkbenchVersions({
          projectId: project.id,
          id: experimentId,
          limit: 2,
        });
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPage = await service.listWorkbenchVersions({
          projectId: project.id,
          id: experimentId,
          limit: 2,
          cursor: firstPage.nextCursor ?? undefined,
        });

        const walked = [...firstPage.versions, ...secondPage.versions].map(
          (entry) => entry.counterVersion,
        );
        expect(walked).toHaveLength(4);
        expect(new Set(walked).size).toBe(4);
        expect([...walked].sort((a, b) => b - a)).toEqual(walked);
      });

      it("puts the version the experiment holds first", async () => {
        const { experimentId } = await typeThenCommitTwice();

        const experiment = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        const { versions } = await service.listWorkbenchVersions({
          projectId: project.id,
          id: experimentId,
        });

        expect(versions[0]?.counterVersion).toBe(experiment.workbenchVersion);
      });
    });
  });

  describe("given a version history holding an autosave", () => {
    describe("when the autosave row is restored", () => {
      /** @scenario "A restore of the autosave says so instead of naming a number" */
      it("names the autosave rather than a number no reader can see", async () => {
        const { experimentId } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Typed, never committed"),
          actor: { label: "user" },
        });
        const rows = await versionRows(experimentId);
        const autoSaved = rows.find((row) => row.autoSaved);

        const restored = await service.restoreWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          version: autoSaved?.version ?? 0,
          actor: { label: "user" },
        });

        const written = await prisma.experimentVersion.findFirstOrThrow({
          where: {
            experimentId,
            projectId: project.id,
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
        const { experimentId } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Typed once"),
          actor: { label: "user" },
        });
        await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "Straight after",
          actor: { label: "user" },
        });

        const rows = await versionRows(experimentId);
        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((row) => row.version)).size).toBe(3);
        expect(
          rows.filter((row) => !row.autoSaved).map((row) => row.version),
        ).toEqual([1, 2]);

        const experiment = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect(rows.find((row) => row.autoSaved)?.version).toBe(
          experiment.workbenchVersion,
        );
      });
    });
  });

  describe("given a caller committing a named version", () => {
    describe("when the commit is accepted", () => {
      /** @scenario A commit creates a numbered version with its message */
      it("adds a numbered row carrying the message", async () => {
        const { experimentId } = await createEvaluation();
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Edited"),
          actor: { label: "user" },
        });

        const committed = await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "Ready for review",
          actor: { label: "user" },
        });

        // A save reports the counter it produced, and the row it wrote is the
        // one holding that counter. The row's own number belongs to the
        // numbered sequence, which counts deliberate versions rather than
        // saves, so the two are not the same number.
        const rows = await versionRows(experimentId);
        const commit = rows.find(
          (row) => row.counterVersion === committed.version,
        );
        expect(commit?.autoSaved).toBe(false);
        expect(commit?.commitMessage).toBe("Ready for review");
      });
    });
  });

  describe("given the assistant writing on a user's behalf", () => {
    describe("when it saves through the seam", () => {
      /** @scenario An assistant write is recorded as its own version */
      it("adds a numbered row attributed to the assistant", async () => {
        const { experimentId } = await createEvaluation();

        const saved = await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Written by the assistant"),
          actor: { label: "langy" },
        });

        const rows = await versionRows(experimentId);
        const written = rows.find(
          (row) => row.counterVersion === saved.version,
        );
        expect(written?.autoSaved).toBe(false);
        expect(written?.authorLabel).toBe("langy");
      });
    });
  });

  describe("given an evaluation with an earlier version", () => {
    describe("when that version is restored", () => {
      /** @scenario A restore writes the old state forward */
      it("writes the old state forward and keeps the history", async () => {
        const { experimentId } = await createEvaluation();
        const first = await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "The one to come back to",
          actor: { label: "user" },
        });
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("Something else"),
          actor: { label: "user" },
        });

        const restored = await service.restoreWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          version: first.version,
          actor: { label: "user" },
        });

        expect(restored.version).toBeGreaterThan(first.version);

        const current = await service.getWorkbenchState({
          projectId: project.id,
          id: experimentId,
        });
        const original = await prisma.experimentVersion.findFirstOrThrow({
          where: {
            experimentId,
            projectId: project.id,
            version: first.version,
          },
        });
        expect(current.state?.name).toBe(
          (original.state as { name: string }).name,
        );

        const rows = await versionRows(experimentId);
        expect(rows.map((row) => row.version)).toContain(first.version);
        expect(
          rows.find((row) => row.counterVersion === restored.version)
            ?.commitMessage,
        ).toBe(`Restored from v${first.version}`);
      });
    });

    describe("when a version number it never had is restored", () => {
      it("refuses with the version-not-found code", async () => {
        const { experimentId } = await createEvaluation();

        expect(
          await codeOf(
            service.restoreWorkbenchVersion({
              projectId: project.id,
              id: experimentId,
              version: 9999,
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_version_not_found");
      });
    });
  });

  describe("given an evaluation with an earlier version and a completed run", () => {
    describe("when that version is restored", () => {
      /** @scenario A restore keeps the current run's results */
      it("brings the old setup back and keeps the run's cells", async () => {
        const { experimentId } = await createEvaluation();
        const earlier = await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "The setup to come back to",
          actor: { label: "user" },
        });
        const earlierName = (
          await service.getWorkbenchState({
            projectId: project.id,
            id: experimentId,
          })
        ).state?.name;

        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateNamed("A setup nobody wants"),
          actor: { label: "user" },
        });
        // The run lands on the live row, which is the only place results live.
        await service.saveWorkbenchState({
          projectId: project.id,
          id: experimentId,
          state: stateWithResults("A setup nobody wants", "what the run said"),
          actor: { label: "api" },
          commitMessage: "Results from run run_1",
        });

        await service.restoreWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          version: earlier.version,
          actor: { label: "user" },
        });

        const current = await service.getWorkbenchState({
          projectId: project.id,
          id: experimentId,
        });
        expect(current.state?.name).toBe(earlierName);
        expect(current.state?.results?.targetOutputs[TARGET_ID]).toEqual([
          { output: "what the run said" },
        ]);
        expect(current.state?.results?.runId).toBe("run_1");
      });
    });
  });

  describe("given two saves of the same evaluation that both read one version", () => {
    // Neither save names an expected version, so the pre-check is skipped and
    // the only thing that can refuse one of them is the compare-and-set itself:
    // the update matches no row, Prisma raises P2025, and the seam turns that
    // into the stale answer.
    const raceTwoSaves = async () => {
      const { experimentId, version } = await createEvaluation();

      let releaseWaitingWriter: () => void = () => undefined;
      const otherWriterHasRead = new Promise<void>((resolve) => {
        releaseWaitingWriter = resolve;
      });

      // Whichever writer reads first waits there. The other reads the same
      // stored version while it waits, updates and commits. Only then does the
      // waiting one try its compare-and-set, which now matches no row.
      let isFirstRead = true;
      const racingService = gatedService(async () => {
        if (!isFirstRead) {
          releaseWaitingWriter();
          return;
        }
        isFirstRead = false;
        await otherWriterHasRead;
      });

      const attempt = async (
        name: string,
      ): Promise<{
        name: string;
        code: string;
        meta: Record<string, unknown>;
      }> => {
        try {
          await racingService.saveWorkbenchState({
            projectId: project.id,
            id: experimentId,
            state: stateNamed(name),
            actor: { label: "user" },
          });
          return { name, code: "no_error", meta: {} };
        } catch (error) {
          if (!HandledError.isHandled(error)) {
            return { name, code: "not_handled", meta: {} };
          }
          return { name, code: error.code, meta: error.meta ?? {} };
        }
      };

      const outcomes = await Promise.all([
        attempt("Writer A"),
        attempt("Writer B"),
      ]);
      return { experimentId, version, outcomes };
    };

    describe("when they race in the database", () => {
      /** @scenario Two saves that race are not both accepted */
      it("accepts one and refuses the other as stale", async () => {
        const { experimentId, version, outcomes } = await raceTwoSaves();

        const accepted = outcomes.filter((one) => one.code === "no_error");
        const refused = outcomes.filter(
          (one) => one.code === "experiment_stale_workbench_state",
        );
        expect(accepted).toHaveLength(1);
        expect(refused).toHaveLength(1);

        const row = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });
        expect((row.workbenchState as { name: string }).name).toBe(
          accepted[0]?.name,
        );
        expect(row.workbenchVersion).toBe(version + 1);
      });

      /** @scenario "A refusal names the version the server holds now" */
      it("tells the refused writer the version the winner created", async () => {
        const { version, outcomes } = await raceTwoSaves();

        // The refused writer read `version` before the winner committed.
        // Sending that number back would point it at a version the server has
        // already left, and its next save would be refused all over again.
        const refused = outcomes.find(
          (one) => one.code === "experiment_stale_workbench_state",
        );
        expect(refused?.meta).toEqual({
          currentVersion: version + 1,
          actorLabel: "user",
        });
      });
    });
  });

  describe("given an evaluation whose counter moved without a version row", () => {
    describe("when the workbench state is read", () => {
      /** @scenario "A version with no row of its own names nobody" */
      it("names nobody, rather than the author of the older version", async () => {
        const { experimentId } = await createEvaluation();
        expect(
          (
            await service.getWorkbenchState({
              projectId: project.id,
              id: experimentId,
            })
          ).actorLabel,
        ).toBe("user");

        // What a workflow evaluation does: it refreshes the state and moves the
        // counter, and writes no version row, because there is nothing there a
        // person would want to restore.
        await prisma.experiment.updateMany({
          where: { id: experimentId, projectId: project.id },
          data: { workbenchVersion: { increment: 1 } },
        });

        const view = await service.getWorkbenchState({
          projectId: project.id,
          id: experimentId,
        });
        expect(view.actorLabel).toBeUndefined();
      });
    });
  });

  describe("given an archived evaluation", () => {
    describe("when a stale client saves with its id", () => {
      /** @scenario An archived evaluation refuses a save */
      it("refuses as not found and leaves the archived row alone", async () => {
        const { experimentId } = await createEvaluation();
        await service.archive({ projectId: project.id, id: experimentId });

        const archived = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
        });

        expect(
          await codeOf(
            service.saveWorkbenchState({
              projectId: project.id,
              id: experimentId,
              state: stateNamed("Stale autosave"),
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_not_found");

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: project.id },
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
        const { experimentId } = await createEvaluation(otherProject.id);
        const before = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: otherProject.id },
        });

        expect(
          await codeOf(
            service.saveWorkbenchState({
              projectId: project.id,
              id: experimentId,
              state: stateNamed("Not yours"),
              actor: { label: "user" },
            }),
          ),
        ).toBe("experiment_not_found");

        const after = await prisma.experiment.findFirstOrThrow({
          where: { id: experimentId, projectId: otherProject.id },
        });
        expect(after.workbenchVersion).toBe(before.workbenchVersion);
        expect(after.workbenchState).toEqual(before.workbenchState);
      });
    });
  });

  describe("given an evaluation with several versions", () => {
    describe("when the versions are listed", () => {
      it("returns them newest first", async () => {
        const { experimentId } = await createEvaluation();
        await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "Second",
          actor: { label: "user" },
        });
        await service.commitWorkbenchVersion({
          projectId: project.id,
          id: experimentId,
          commitMessage: "Third",
          actor: { label: "user" },
        });

        const { versions } = await service.listWorkbenchVersions({
          projectId: project.id,
          id: experimentId,
        });

        expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
        expect(versions[0]?.commitMessage).toBe("Third");
      });
    });
  });
});
