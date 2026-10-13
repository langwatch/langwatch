import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace, Protections } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceLegacyRead } from "../../trace-viewer.service.ts";
import { TraceViewerReadService } from "../../trace-viewer.service.ts";

const protections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: null,
  capturedOutputVisibleTo: null,
  contentCategories: {
    input: { canSee: true, restrictVisibleTo: null },
    output: { canSee: true, restrictVisibleTo: null },
    system: { canSee: true, restrictVisibleTo: null },
    tools: { canSee: true, restrictVisibleTo: null },
  },
  hiddenAttributes: [],
  visibilityCutoffMs: null,
};

describe("TraceViewerReadService", () => {
  it("resolves the named viewer and requests one full hydrated read", async () => {
    const trace = { trace_id: "trace-1" } as Trace;
    const getTracesWithSpans = vi.fn(async () => [trace]);
    const read = createApiFixture<TraceLegacyRead>({ getTracesWithSpans });
    const resolve = vi.fn(async () => protections);
    const proof = ownProof({ projectId: "project-1" });
    const authorize = vi.fn(async () => proof);
    const service = TraceViewerReadService.create({ read, protections: { resolve }, authorize });

    await expect(
      service.readForViewer({
        projectId: "project-1",
        userId: "user-1",
        traceIds: ["trace-1"],
      }),
    ).resolves.toEqual([trace]);

    expect(resolve).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      publiclyShared: false,
    });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
    expect(getTracesWithSpans).toHaveBeenCalledWith({
      authorization: proof,
      projectId: "project-1",
      traceIds: ["trace-1"],
      protections,
      opts: { full: true },
    });
  });
});
