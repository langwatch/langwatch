import { describe, expect, it, vi } from "vitest";
import type { Trace, Protections } from "@langwatch/trace-contract";
import { TraceViewerReadService } from "../trace-viewer.service.ts";
import { TraceViewerProtectionService } from "../trace-viewer-protection.service.ts";
import type { TraceLegacyReadPort } from "../../ports/trace-legacy-read.port.ts";

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
    const read = { getTracesWithSpans } as unknown as TraceLegacyReadPort;
    const resolve = vi.fn(async () => protections);
    const viewerProtections = Object.create(
      TraceViewerProtectionService.prototype,
    ) as TraceViewerProtectionService;
    Object.defineProperty(viewerProtections, "resolve", { value: resolve });
    const service = TraceViewerReadService.create({ read, protections: viewerProtections });

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
    expect(getTracesWithSpans).toHaveBeenCalledWith(
      "project-1",
      ["trace-1"],
      protections,
      undefined,
      { full: true },
    );
  });
});
