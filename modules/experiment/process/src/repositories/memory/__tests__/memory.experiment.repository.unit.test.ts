import { ExperimentNotFoundError } from "@langwatch/experiment-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ArchivedExperimentWriteError } from "../../experiment.repository.ts";
import {
  MemoryExperimentPeopleRepository,
  MemoryExperimentRunAbortRepository,
  MemoryExperimentWorkflowVersionRepository,
} from "../memory.experiment.repositories.ts";
import { MemoryExperimentRepository } from "../memory.experiment.repository.ts";

const projectId = "project-1";
const id = "experiment-1";

async function createdWorkbench() {
  const repository = MemoryExperimentRepository.create();
  await repository.createWorkbenchState({
    projectId,
    id,
    slug: "my-experiment",
    name: "My experiment",
    state: { step: 0 },
    snapshot: { step: 0 },
    actor: { userId: "user-1", label: "user" },
    commitMessage: "first",
  });
  return repository;
}

function userWrite({ step, expectedVersion }: { step: number; expectedVersion?: number }) {
  return {
    projectId,
    id,
    name: "My experiment",
    state: { step },
    snapshot: { step },
    expectedVersion,
    actor: { userId: "user-1", label: "user" as const },
  };
}

describe("MemoryExperimentRepository", () => {
  describe("when a write names a version the row has moved past", () => {
    it("refuses it as stale and keeps the current state", async () => {
      const repository = await createdWorkbench();
      await repository.writeWorkbenchState(userWrite({ step: 1, expectedVersion: 1 }));

      const stale = await repository.writeWorkbenchState(
        userWrite({ step: 2, expectedVersion: 1 }),
      );

      expect(stale).toEqual({ kind: "stale", currentVersion: 2, actorLabel: "user" });
      const view = await repository.findWorkbenchState({ projectId, id });
      expect(view.version).toBe(2);
    });
  });

  describe("when a user saves twice without a commit message", () => {
    it("rolls one auto-saved version forward beside the committed one", async () => {
      const repository = await createdWorkbench();
      await repository.writeWorkbenchState(userWrite({ step: 1 }));
      await repository.writeWorkbenchState(userWrite({ step: 2 }));

      const versions = await repository.findWorkbenchVersions({
        projectId,
        experimentId: id,
        take: 10,
      });

      expect(versions.map(({ version, autoSaved }) => ({ version, autoSaved }))).toEqual([
        { version: 3, autoSaved: true },
        { version: 1, autoSaved: false },
      ]);
      await expect(
        repository.findWorkbenchVersion({ projectId, experimentId: id, version: 3 }),
      ).resolves.toEqual({ autoSaved: true, state: { step: 2 } });
    });
  });

  describe("when the experiment is archived", () => {
    it("refuses every further write", async () => {
      const repository = await createdWorkbench();
      const archived = await repository.archiveActive({
        projectId,
        id,
        archivedSlug: "my-experiment-archived",
        archivedAt: nowInstant(),
      });

      expect(archived).toBe(true);
      await expect(
        repository.saveActive({
          id,
          projectId,
          name: "Renamed",
          type: "EVALUATIONS_V3",
          slug: "my-experiment",
          requestedSlug: "my-experiment",
          slugMode: "preserve-existing",
          workbenchState: null,
        }),
      ).rejects.toBeInstanceOf(ArchivedExperimentWriteError);
      await expect(repository.writeWorkbenchState(userWrite({ step: 1 }))).rejects.toBeInstanceOf(
        ExperimentNotFoundError,
      );
      await expect(
        repository.archiveActive({
          projectId,
          id,
          archivedSlug: "again",
          archivedAt: nowInstant(),
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("the experiment's peer-written memory twins", () => {
  it("names no author, since the user module writes people", async () => {
    await expect(MemoryExperimentPeopleRepository.create().namesOf(["user-1"])).resolves.toEqual(
      [],
    );
  });

  it("finds no workflow version, since the workflow module writes them", async () => {
    await expect(
      MemoryExperimentWorkflowVersionRepository.create().findByIds({
        projectId,
        versionIds: ["version-1"],
      }),
    ).resolves.toEqual({});
  });

  it("holds a stop request for the run it names and no other", async () => {
    const aborts = MemoryExperimentRunAbortRepository.create();
    await aborts.requestAbort("run-1");

    await expect(aborts.isAborted("run-1")).resolves.toBe(true);
    await expect(aborts.isAborted("run-2")).resolves.toBe(false);
  });
});
