import { createApiFixture } from "@langwatch/api-fixture";
import { ExperimentTypeMismatchError } from "@langwatch/experiment-contract";
/**
 * Type check in repository; service relays refusal consistently.
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import type { ExperimentRepository } from "../../repositories/experiment.repository.ts";
import { ExperimentWorkbenchService } from "../experiment-workbench.service.ts";

/** Minimally valid so `parseWorkbenchState` clears before the repository's
 *  own row-type refusal is reached. */
const validState = {
  name: "My evaluation",
  datasets: [],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
};

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "not_handled";
  }
  return "no_error";
};

/** Awaits `promise`, returning what it rejected with, or fails the test if it did not reject. */
const thrownBy = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to be refused");
};

function makeService(): ExperimentWorkbenchService {
  const repository = createApiFixture<ExperimentRepository>({
    findWorkbenchState: async () => {
      throw new ExperimentTypeMismatchError();
    },
    resolveWorkbenchSaveTarget: async () => {
      throw new ExperimentTypeMismatchError();
    },
  });

  return ExperimentWorkbenchService.create({
    repository,
    newId: () => "generated-id",
    updates: { publish: async () => undefined } as never,
    slugs: {} as never,
    references: {} as never,
    draftNames: { findNextDraftName: async () => "Draft 1" },
  });
}

describe("given an experiment that is not an evaluations workbench", () => {
  describe("when its workbench state is read", () => {
    /** @scenario A workbench call on another kind of experiment is refused with a code */
    it("refuses with the type-mismatch code and a 400", async () => {
      const service = makeService();

      const error = await thrownBy(
        service.getWorkbenchState({ projectId: "project_1", id: "experiment_1" }),
      );
      expect(HandledError.isHandled(error)).toBe(true);
      if (!HandledError.isHandled(error)) return;
      expect(error.code).toBe("experiment_type_mismatch");
      expect(error.httpStatus).toBe(400);
    });
  });

  describe("when a workbench save targets it", () => {
    it("refuses with the same code", async () => {
      const service = makeService();

      expect(
        await codeOf(
          service.saveWorkbenchState({
            projectId: "project_1",
            id: "experiment_1",
            state: validState,
            actor: { label: "user" },
          }),
        ),
      ).toBe("experiment_type_mismatch");
    });
  });
});
