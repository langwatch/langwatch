/**
 * Integration tests for the versioned workbench write seam against real
 * Postgres. They exist to prove the parts a mocked repository cannot: that the
 * compare-and-set really refuses a racing write, that exactly one rolling
 * autosave row survives a long editing session, and that a restore adds to the
 * history instead of rewriting it.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Project } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { ExperimentService } from "../experiment.service";

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
    service = ExperimentService.create(prisma);
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
          expect(meta).toEqual({ currentVersion: version + 1 });
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

        const rows = await versionRows(experimentId);
        const commit = rows.find((row) => row.version === committed.version);
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
        const written = rows.find((row) => row.version === saved.version);
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
          rows.find((row) => row.version === restored.version)?.commitMessage,
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
