/**
 * @see specs/experiments-v3/workbench-versioning.feature
 *
 * The row-type check moved to the repository (`prisma.experiment.repository.ts`
 * throws `ExperimentTypeMismatchError` for a row that is not
 * `EVALUATIONS_V3`), but the workbench service still has to be the one that
 * hands the refusal on rather than swallowing or repackaging it — a workbench
 * call on any other kind of experiment must reach the caller as the same
 * customer-safe, coded refusal every time.
 */
import { HandledError } from "@langwatch/handled-error";
import { ExperimentTypeMismatchError } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";
import { ExperimentWorkbenchService } from "../experiment-workbench.service";
import type { ExperimentRepository } from "../../repositories/experiment.repository";

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

function makeService(): ExperimentWorkbenchService {
  const repository = {
    getWorkbenchState: async () => {
      throw new ExperimentTypeMismatchError();
    },
    resolveWorkbenchSaveTarget: async () => {
      throw new ExperimentTypeMismatchError();
    },
  } as unknown as ExperimentRepository;

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

      try {
        await service.getWorkbenchState({ projectId: "project_1", id: "experiment_1" });
        expect.unreachable("the read should have been refused");
      } catch (error) {
        expect(HandledError.isHandled(error)).toBe(true);
        if (!HandledError.isHandled(error)) return;
        expect(error.code).toBe("experiment_type_mismatch");
        expect(error.httpStatus).toBe(400);
      }
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
