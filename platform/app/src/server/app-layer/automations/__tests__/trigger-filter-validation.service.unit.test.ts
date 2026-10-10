import { describe, expect, it, vi } from "vitest";
import type { EvaluatorReferenceRepository } from "../repositories/evaluator-reference.repository";
import { TriggerFilterValidationService } from "../trigger-filter-validation.service";

const serviceWith = (
  rows: Awaited<ReturnType<EvaluatorReferenceRepository["findAllByIds"]>>,
) => {
  const findAllByIds = vi.fn(async () => rows);
  return {
    service: new TriggerFilterValidationService({ findAllByIds }),
    findAllByIds,
  };
};

describe("TriggerFilterValidationService.assertWritable()", () => {
  describe("when a keyed field is a bare list", () => {
    /** @scenario "A keyed condition written without its key is refused" */
    it("refuses with trigger_filter_key_required naming the nested shape", async () => {
      const { service, findAllByIds } = serviceWith([]);

      await expect(
        service.assertWritable({
          projectId: "project-1",
          filters: { "evaluations.passed": ["false"] },
        }),
      ).rejects.toMatchObject({
        code: "trigger_filter_key_required",
        httpStatus: 422,
        message: expect.stringContaining(
          '{"evaluations.passed":{"<monitorId>":["false"]}}',
        ),
      });
      expect(findAllByIds).not.toHaveBeenCalled();
    });
  });

  describe("when an evaluation condition is keyed by an evaluator id", () => {
    /** @scenario "An evaluation condition keyed by an evaluator names its monitors" */
    it("refuses with trigger_filter_monitor_required naming the monitors", async () => {
      const { service, findAllByIds } = serviceWith([
        { evaluatorId: "evaluator_1", monitorIds: ["monitor_a", "monitor_b"] },
      ]);

      await expect(
        service.assertWritable({
          projectId: "project-1",
          filters: { "evaluations.passed": { evaluator_1: ["false"] } },
        }),
      ).rejects.toMatchObject({
        code: "trigger_filter_monitor_required",
        httpStatus: 422,
        meta: expect.objectContaining({
          evaluatorId: "evaluator_1",
          monitorIds: ["monitor_a", "monitor_b"],
        }),
        message: expect.stringContaining('"monitor_a", "monitor_b"'),
      });
      expect(findAllByIds).toHaveBeenCalledWith({
        projectId: "project-1",
        ids: ["evaluator_1"],
      });
    });
  });

  describe("when the ids are monitors or SDK evaluator ids", () => {
    it("accepts the conditions", async () => {
      const { service } = serviceWith([]);

      await expect(
        service.assertWritable({
          projectId: "project-1",
          filters: {
            "evaluations.passed": { monitor_1: ["false"] },
            "evaluations.label": { "my-sdk-check": ["toxic"] },
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when no evaluation condition is stated", () => {
    it("does not query", async () => {
      const { service, findAllByIds } = serviceWith([]);

      await service.assertWritable({
        projectId: "project-1",
        filters: { "spans.model": ["gpt-5-mini"] },
      });

      expect(findAllByIds).not.toHaveBeenCalled();
    });
  });
});
