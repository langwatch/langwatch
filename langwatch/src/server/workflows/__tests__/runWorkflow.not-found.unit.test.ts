/**
 * Found via a systematic MCP tool sweep: platform_run_workflow on a
 * nonexistent workflow ID returned a raw 500 ("Workflow not found.") while
 * platform_get_workflow/platform_delete_workflow on the exact same ID
 * correctly returned 404. runWorkflow() threw a plain Error, which falls
 * through every case in error-handler.ts's determineErrorResponse() and
 * lands in the generic 500 catch-all -- the same bug class as
 * ModelNotConfiguredError (see fix/model-not-configured-error-500).
 */
import { describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
vi.mock("../../db", () => ({
  prisma: {
    workflow: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
  },
}));

import { NotFoundError, UnprocessableEntityError } from "~/app/api/shared/errors";
import { runWorkflow } from "../runWorkflow";

describe("runWorkflow()", () => {
  describe("when the workflow does not exist", () => {
    it("throws NotFoundError instead of a plain Error", async () => {
      findUniqueMock.mockResolvedValue(null);

      await expect(
        runWorkflow("nonexistent-workflow", "project_123", {}),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("when the workflow exists but has never been published", () => {
    it("throws UnprocessableEntityError instead of a plain Error", async () => {
      findUniqueMock.mockResolvedValue({ id: "wf_1", publishedId: null });

      await expect(
        runWorkflow("wf_1", "project_123", {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityError);
    });
  });
});
