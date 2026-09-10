/**
 * @see specs/studio/nlp-lambda-cleanup.feature
 * The sweep of the studio's quiet per-project NLP engines, as the module's own
 * operation rather than a process's port.
 */
// @vitest-environment node
import { NlpLambdaFleetNotComposedError } from "@langwatch/workflow-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { WorkflowApp, type NlpLambdaFleet } from "../workflow.app.ts";
import { createWorkflowTestInfrastructure } from "./workflow.fixture.ts";

/**
 * The App reads nothing off a setup but its members, so a test builds the one
 * it cares about rather than booting a process to reach one method.
 */
function appWith(fleet?: NlpLambdaFleet): WorkflowApp {
  const infrastructure = createWorkflowTestInfrastructure(fleet ? { nlpLambdaFleet: fleet } : {});

  return WorkflowApp.create({ infrastructure } as Parameters<typeof WorkflowApp.create>[0]);
}

describe("the studio's NLP Lambda sweep", () => {
  describe("given a deployment that composed no NLP Lambda account", () => {
    /** @scenario "A deployment that composed no Lambda account refuses the sweep by name" */
    it("refuses by name rather than reporting there was nothing to delete", async () => {
      await expect(appWith().cleanupOldLambdas()).rejects.toThrow(NlpLambdaFleetNotComposedError);
    });
  });

  describe("given a deployment whose studio engines can be swept", () => {
    /** @scenario "A completed sweep answers the sentence the scheduler expects" */
    it("reads the account through the fleet it was composed with", async () => {
      const listFunctions = vi.fn(async () => [{ name: "langwatch_nlp_project-1" }] as const);
      const deleteFunction = vi.fn(async () => {});
      const fleet: NlpLambdaFleet = {
        listFunctions,
        tryReadLastActivityAt: async () =>
          Temporal.Now.instant().subtract({ hours: 24 * 30 }),
        functionExists: async () => true,
        deleteFunction,
        listLogGroups: async () => [],
        deleteLogGroup: async () => {},
      };

      await appWith(fleet).cleanupOldLambdas();

      expect(listFunctions).toHaveBeenCalledTimes(1);
      expect(deleteFunction).toHaveBeenCalledWith({ functionName: "langwatch_nlp_project-1" });
    });
  });
});
