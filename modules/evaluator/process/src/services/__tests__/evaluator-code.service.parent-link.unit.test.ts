/**
 * A code evaluator must not ask the engine to emit spans when it has no
 * parent link to hand it: the engine would mint a fresh trace id and the
 * evaluator's spans would become a separate evaluation-origin trace (#8192).
 */

import { createApiFixture } from "@langwatch/api-fixture";
import type { Evaluator } from "@langwatch/evaluator-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { EvaluatorRepository } from "../../repositories/evaluator.repository.ts";
import type { EvaluatorCodeExecution } from "../evaluator-code-execution.service.ts";
import { EvaluatorCodeService } from "../evaluator-code.service.ts";

const savedEvaluator: Evaluator = {
  id: "evaluator_parent_link_test",
  projectId: "test-project-id",
  name: "Parent Link Test Evaluator",
  slug: "parent-link-test-evaluator",
  type: "code",
  config: {
    code: "class Code:\n    def __call__(self, output: str):\n        ...\n",
    inputs: [{ identifier: "output", type: "str" }],
    outputs: [{ identifier: "passed", type: "bool" }],
  },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** The event the service handed the engine, captured off the enrichment seam. */
function buildService() {
  const sent: StudioClientEvent[] = [];
  const repository = createApiFixture<EvaluatorRepository>({
    findById: async () => savedEvaluator,
  });
  const workflows = {
    enrichStudioEvent: async ({ event }: { event: StudioClientEvent }) => {
      sent.push(event);
      return event;
    },
  } as never;
  const codeExecution: EvaluatorCodeExecution = {
    execute: async () => ({
      ok: true,
      statusText: "OK",
      body: { status: "success", result: { passed: true } },
    }),
  };

  return {
    sent,
    service: EvaluatorCodeService.create({
      repository,
      workflows,
      codeExecution,
      generateId: () => "fixed-id",
    }),
  };
}

function doNotTraceOf(event: StudioClientEvent): unknown {
  return (event as { payload?: { do_not_trace?: unknown } }).payload?.do_not_trace;
}

describe("EvaluatorCodeService execute", () => {
  describe("when the caller hands it no parent trace", () => {
    it("asks the engine not to emit spans", async () => {
      const { service, sent } = buildService();

      await service.execute({
        projectId: "test-project-id",
        evaluatorId: "evaluator_parent_link_test",
        data: { output: "hello" },
      });

      expect(doNotTraceOf(sent[0]!)).toBe(true);
    });
  });

  describe("when the caller hands it a parent trace", () => {
    it("lets the engine emit spans under it", async () => {
      const { service, sent } = buildService();

      await service.execute({
        projectId: "test-project-id",
        evaluatorId: "evaluator_parent_link_test",
        data: { output: "hello" },
        parentTrace: { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" },
      });

      expect(doNotTraceOf(sent[0]!)).toBe(false);
    });
  });
});
