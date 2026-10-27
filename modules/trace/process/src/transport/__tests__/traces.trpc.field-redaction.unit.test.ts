import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The field redaction door, served where the protections are resolved.
 * @see modules/trace/specs/trace-viewer-protection.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { Protections, TraceApi } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const READER = { id: "reader-1" };
const READER_PROTECTIONS: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: "Admins",
  capturedOutputVisibleTo: null,
};

function harness() {
  const resolveViewerProtections = vi.fn<TraceApi["resolveViewerProtections"]>(async (input) =>
    input.projectId === PROJECT_ID && input.userId === READER.id ? READER_PROTECTIONS : {},
  );
  const app = createApiFixture<TraceApi>({ resolveViewerProtections });

  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(tracesTrpcTransport, () => app);

  return { caller: router.createCaller({ actor: READER }), resolveViewerProtections };
}

describe("given trace input on a project is hidden from a reader and visible to Admins", () => {
  describe("when the reader asks traces for the project's field redaction status", () => {
    /** @scenario "The field redaction status answers from the reader's own protections" */
    it("answers the input as redacted and visible to Admins, and the output as visible", async () => {
      const { caller, resolveViewerProtections } = harness();

      await expect(caller.getFieldRedactionStatus({ projectId: PROJECT_ID })).resolves.toEqual({
        isRedacted: { input: true, output: false },
        visibleTo: { input: "Admins", output: null },
      });
      expect(resolveViewerProtections).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: READER.id,
      });
    });
  });
});
