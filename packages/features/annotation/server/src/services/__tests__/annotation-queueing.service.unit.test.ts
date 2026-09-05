/**
 * See specs/traces-v2/bulk-actions.feature.
 */
import { describe, expect, it, vi } from "vitest";
import type { AnnotationService } from "@langwatch/annotation-contract";
import { AnnotationQueueingService } from "../annotation-queueing.service";

function fakeAnnotations(): AnnotationService & {
  createQueueItems: ReturnType<typeof vi.fn>;
} {
  return {
    createQueueItems: vi.fn(async () => {}),
    getProjectOrganizationId: vi.fn(async () => "org-1"),
    assertQueueConfigurationReferences: vi.fn(async () => {}),
    assertAnnotatorReferences: vi.fn(async () => {}),
  } as unknown as AnnotationService & { createQueueItems: ReturnType<typeof vi.fn> };
}

describe("AnnotationQueueingService.createOrUpdateQueueItems", () => {
  describe("given the same trace id sent twice in one call", () => {
    /** @scenario The same trace sent twice in one send is queued once */
    it("queues the trace once and counts it once", async () => {
      const annotations = fakeAnnotations();
      const findExistingTraceIds = vi.fn(async (input: { traceIds: string[] }) => input.traceIds);

      const result = await AnnotationQueueingService.createOrUpdateQueueItems({
        traceIds: ["trace-1", "trace-1"],
        projectId: "project-1",
        annotators: ["user-abc"],
        userId: "user-abc",
        annotations,
        findExistingTraceIds,
      });

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(annotations.createQueueItems).toHaveBeenCalledWith(
        expect.objectContaining({ traceIds: ["trace-1"] }),
      );
    });
  });
});
