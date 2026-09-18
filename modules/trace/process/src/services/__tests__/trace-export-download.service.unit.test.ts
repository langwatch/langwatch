/**
 * The prepared export owns the rate window, redactions, progress signals and
 * slot lifetime, before the HTTP bytes door starts consuming its stream.
 * @vitest-environment node
 */
import type { PresenceApi } from "@langwatch/presence-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { TraceExportRateLimitedError, type Protections } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceExportBounds, TraceExportSlot } from "../trace-export-bounds.service.ts";
import { TraceExportDownloadService } from "../trace-export-download.service.ts";
import { TraceExportService } from "../trace-export.service.ts";
import { TraceViewerProtectionService } from "../trace-viewer-protection.service.ts";

const protections = { canSeeCapturedInput: true, canSeeCapturedOutput: true } as Protections;
const request = {
  projectId: "project-1",
  mode: "full" as const,
  format: "csv" as const,
  filters: {},
  startDate: 0,
  endDate: 1,
};

function boundsFake(overrides: Partial<TraceExportBounds> = {}) {
  const slot = { released: 0 };
  const bounds: TraceExportBounds = {
    assertExportWithinRate: async () => {},
    acquireExportSlot: async (): Promise<TraceExportSlot> => ({
      release: async () => {
        slot.released += 1;
      },
    }),
    ...overrides,
  };
  return { bounds, slot };
}

function buildService(options: {
  bounds: TraceExportBounds;
  exportTraces?: TraceExportService["exportTraces"];
  getTotalCount?: TraceExportService["getTotalCount"];
}) {
  const exportTraces = vi.fn(
    options.exportTraces ??
      async function* () {
        yield { chunk: "row-1\\n", progress: { exported: 1, total: 1 } };
      },
  );
  const getTotalCount = vi.fn(options.getTotalCount ?? (async () => 1));
  const exports = createApiFixture<TraceExportService>({ exportTraces, getTotalCount });
  const resolve = vi.fn(async () => protections);
  const viewerProtections = createApiFixture<TraceViewerProtectionService>({ resolve });
  const publishProjectEvent = vi.fn(async () => {});
  const presence = createApiFixture<PresenceApi>({ publishProjectEvent });

  return {
    service: TraceExportDownloadService.create({
      exports,
      protections: viewerProtections,
      bounds: options.bounds,
      presence,
    }),
    exportTraces,
    getTotalCount,
    resolve,
    publishProjectEvent,
  };
}

describe("TraceExportDownloadService", () => {
  it("refuses a spent rate window before resolving protections or reading traces", async () => {
    const { bounds } = boundsFake({
      assertExportWithinRate: async () => {
        throw new TraceExportRateLimitedError({ reason: "rate" });
      },
    });
    const built = buildService({ bounds });

    await expect(built.service.download({ request, userId: "user-1" })).rejects.toMatchObject({
      code: "trace_export_rate_limited",
    });
    expect(built.resolve).not.toHaveBeenCalled();
    expect(built.getTotalCount).not.toHaveBeenCalled();
  });

  it("releases the claimed slot when sizing fails", async () => {
    const { bounds, slot } = boundsFake();
    const built = buildService({
      bounds,
      getTotalCount: async () => {
        throw new Error("ClickHouse unavailable");
      },
    });

    await expect(built.service.download({ request, userId: "user-1" })).rejects.toMatchObject({
      code: "export_failed",
    });
    expect(slot.released).toBe(1);
    expect(built.exportTraces).not.toHaveBeenCalled();
  });

  it("keeps the slot until the bytes complete and publishes progress through Presence", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { bounds, slot } = boundsFake();
    const built = buildService({
      bounds,
      exportTraces: async function* () {
        yield { chunk: "row-1\\n", progress: { exported: 1, total: 2 } };
        await gate;
        yield { chunk: "row-2\\n", progress: { exported: 2, total: 2 } };
      },
    });
    const download = await built.service.download({ request, userId: "user-1" });

    expect(slot.released).toBe(0);
    open();

    const decoder = new TextDecoder();
    let payload = "";
    for await (const chunk of download.stream) {
      payload += decoder.decode(chunk, { stream: true });
    }
    payload += decoder.decode();
    expect(payload).toBe("row-1\\nrow-2\\n");
    expect(slot.released).toBe(1);
    expect(built.publishProjectEvent).toHaveBeenCalledWith({
      projectId: "project-1",
      channel: "export_progress",
      event: expect.stringContaining('"type":"progress"'),
    });
    expect(built.publishProjectEvent).toHaveBeenLastCalledWith({
      projectId: "project-1",
      channel: "export_progress",
      event: JSON.stringify({ exportId: download.exportId, type: "done" }),
    });
  });

  it("releases the slot when the bytes consumer cancels the export", async () => {
    const { bounds, slot } = boundsFake();
    const built = buildService({
      bounds,
      exportTraces: async function* () {
        yield { chunk: "row-1\\n", progress: { exported: 1, total: 2 } };
        await new Promise<void>(() => {});
      },
    });
    const download = await built.service.download({ request, userId: "user-1" });
    await download.cancel();

    expect(slot.released).toBe(1);
  });
});
