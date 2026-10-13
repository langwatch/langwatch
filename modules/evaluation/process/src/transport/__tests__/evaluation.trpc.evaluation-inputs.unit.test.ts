import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The evaluation card's inputs read, served where the inputs are stored.
 * @see modules/evaluation/specs/evaluation-inputs-door.feature
 */
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { evaluationTrpcTransport } from "../evaluation.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const STORED_INPUTS = { input: "What is the refund window?", contexts: ["30 days"] };

function harness() {
  const findInputs = vi.fn<EvaluationApi["findInputs"]>(async (query) =>
    query.projectId === PROJECT_ID && query.evaluationId === "eval-1" ? STORED_INPUTS : null,
  );
  const app = createApiFixture<EvaluationApi>({ findInputs });

  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(evaluationTrpcTransport, () => app);

  return { caller: router.createCaller({ actor: { id: "reader-1" } }), findInputs };
}

describe("given an evaluation in a project whose inputs evaluation stored", () => {
  describe("when the trace drawer asks evaluations for that evaluation's inputs", () => {
    /** @scenario "An evaluation card reads the evaluation's inputs from evaluations" */
    it("answers the inputs evaluation resolves for the project's tenant", async () => {
      const { caller, findInputs } = harness();

      await expect(
        caller.getEvaluationInputs({ projectId: PROJECT_ID, evaluationId: "eval-1" }),
      ).resolves.toEqual(STORED_INPUTS);
      expect(findInputs).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        evaluationId: "eval-1",
        userId: "reader-1",
        authorization: expect.objectContaining({ grants: expect.any(Array) }),
      });
    });
  });
});

describe("given an evaluation in a project with no stored inputs", () => {
  describe("when the trace drawer asks evaluations for that evaluation's inputs", () => {
    /** @scenario "An evaluation with no stored inputs answers none" */
    it("answers no inputs", async () => {
      const { caller } = harness();

      await expect(
        caller.getEvaluationInputs({ projectId: PROJECT_ID, evaluationId: "eval-unknown" }),
      ).resolves.toBeNull();
    });
  });
});

describe("given an aggregate whose drawer is on a member", () => {
  describe("when the trace drawer asks for an evaluation's inputs", () => {
    it("hands evaluations the member so the proof narrows to it", async () => {
      const { caller, findInputs } = harness();

      await caller.getEvaluationInputs({
        projectId: PROJECT_ID,
        evaluationId: "eval-1",
        tenantId: "member-1",
      });

      expect(findInputs).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, tenantId: "member-1" }),
      );
    });
  });
});
