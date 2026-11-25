import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { evaluatorAttachmentSchema, type EvaluatorAttachment } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { ScenarioRunAttachmentsService } from "../scenario-run-attachments.service.ts";

const attachment = (evaluatorId: string): EvaluatorAttachment =>
  evaluatorAttachmentSchema.parse({
    id: `att_${evaluatorId}`,
    evaluatorId,
    required: false,
    mappings: {},
  });

function service(testSuites: { id: string; evaluators: EvaluatorAttachment[] }[]) {
  const findByIdWithFields = vi.fn(async ({ id }: { id: string; projectId: string }) =>
    id === "ev_missing" ? undefined : ({ id, name: `Evaluator ${id}` } as EvaluatorWithFields),
  );
  const listTestSuites = vi.fn(async () => testSuites);
  return {
    findByIdWithFields,
    listTestSuites,
    attachments: ScenarioRunAttachmentsService.create({
      scenarios: { listTestSuites } as never,
      evaluators: { findByIdWithFields },
    }),
  };
}

describe("ScenarioRunAttachmentsService", () => {
  describe("given a run whose scenario is filed in a test suite", () => {
    describe("when grading reads its attachments", () => {
      it("answers the test suite's attachments, each evaluator once, archived suites included", async () => {
        const { attachments, listTestSuites } = service([
          { id: "ts_1", evaluators: [attachment("ev_a"), attachment("ev_b"), attachment("ev_a")] },
        ]);

        const result = await attachments.getRunAttachments({
          projectId: "p_1",
          suiteId: "ts_1",
          planId: "plan_1",
        });

        expect(result.map((entry) => entry.evaluatorId)).toEqual(["ev_a", "ev_b"]);
        expect(listTestSuites).toHaveBeenCalledWith({ projectId: "p_1", includeArchived: true });
      });
    });
  });

  describe("given a run whose scenario is filed in no test suite", () => {
    describe("when grading reads its attachments", () => {
      it("answers none without reading test suites", async () => {
        const { attachments, listTestSuites } = service([]);

        await expect(
          attachments.getRunAttachments({ projectId: "p_1", suiteId: null }),
        ).resolves.toEqual([]);
        expect(listTestSuites).not.toHaveBeenCalled();
      });
    });
  });

  describe("given attachments naming saved evaluators", () => {
    describe("when grading reads their definitions", () => {
      it("reads each evaluator once through the evaluator Api and leaves unknown ids out", async () => {
        const { attachments, findByIdWithFields } = service([]);

        const result = await attachments.getAttachedEvaluators({
          projectId: "p_1",
          attachments: [attachment("ev_a"), attachment("ev_a"), attachment("ev_missing")],
        });

        expect([...result.keys()]).toEqual(["ev_a"]);
        expect(findByIdWithFields).toHaveBeenCalledTimes(2);
      });
    });
  });
});
