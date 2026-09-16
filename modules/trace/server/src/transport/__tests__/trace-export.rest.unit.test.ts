/**
 * `POST /api/export/traces/download` — the export door's budget: counted
 * after the permission probe, refused before the sizing query, and the
 * in-flight slot held for the whole stream.
 * @vitest-environment node
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { TraceExportRateLimitedError } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  TraceExportBounds,
  TraceExportSlot,
} from "../../services/trace-export-bounds.service.ts";
import { traceExportRest, type TraceExport } from "../trace-export.rest.ts";

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }
  return context.json({ error: "internal_server_error" }, 500);
};

/** The budget a test steers: each method is a real recording double, the slot a flag. */
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

function buildApi({
  bounds,
  exportGate,
}: {
  bounds: TraceExportBounds;
  exportGate?: { promise: Promise<void>; open(): void };
}) {
  const getTotalCount = vi.fn(async () => 2);
  const exportTraces = vi.fn(async function* () {
    yield { chunk: "row-1\n", progress: { exported: 1, total: 2 } };
    await exportGate?.promise;
    yield { chunk: "row-2\n", progress: { exported: 2, total: 2 } };
  });
  const exportService: TraceExport<{ projectId: string; mode: string; format: string }> = {
    getTotalCount,
    exportTraces,
  };

  const members = {
    requestSchema: () => z.object({ projectId: z.string(), mode: z.string(), format: z.string() }),
    resolveSession: async () => ({ userId: "user-1" }),
    probeProjectPermission: async () => true,
    getViewerProtections: async () => ({}),
    exports: () => exportService,
    exportBounds: () => bounds,
    broadcast: () => ({
      broadcastToTenant: async () => {},
      broadcastToTenantRateLimited: async () => {},
    }),
    unauthenticatedError: () => new Error("no session in this suite"),
    exportFailedError: (cause: unknown) => new Error(`export failed: ${String(cause)}`),
  };

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: null, scope: null }),
    },
  });

  const hono = runtime.mount(traceExportRest.router(), {
    app: () => members,
    onError: boundaryErrorHandler,
  });

  const download = () =>
    hono.request("http://api.test/api/export/traces/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "project-1", mode: "full", format: "csv" }),
    });

  return { download, exportService };
}

describe("POST /api/export/traces/download", () => {
  describe("given the project's per-minute export window is spent", () => {
    it("refuses 429 before any export work starts", async () => {
      const { bounds } = boundsFake({
        assertExportWithinRate: async () => {
          throw new TraceExportRateLimitedError({ reason: "rate", retryAfterSeconds: 17 });
        },
      });
      const { download, exportService } = buildApi({ bounds });

      const response = await download();

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: "trace_export_rate_limited" });
      expect(exportService.getTotalCount).not.toHaveBeenCalled();
      expect(exportService.exportTraces).not.toHaveBeenCalled();
    });
  });

  describe("given the project's in-flight slots are all held", () => {
    it("refuses 429 before the sizing query runs", async () => {
      const { bounds } = boundsFake({
        acquireExportSlot: async () => {
          throw new TraceExportRateLimitedError({ reason: "concurrency" });
        },
      });
      const { download, exportService } = buildApi({ bounds });

      const response = await download();

      expect(response.status).toBe(429);
      expect(exportService.getTotalCount).not.toHaveBeenCalled();
    });
  });

  describe("given an export stream still producing rows", () => {
    it("holds the slot until the stream ends, then releases it exactly once", async () => {
      let open!: () => void;
      const exportGate = {
        promise: new Promise<void>((resolve) => {
          open = resolve;
        }),
        open: () => open(),
      };
      const { bounds, slot } = boundsFake();
      const { download } = buildApi({ bounds, exportGate });

      const response = await download();
      expect(response.status).toBe(200);
      // Mid-stream: the second row is still behind the gate, so the slot is held.
      expect(slot.released).toBe(0);

      exportGate.open();

      expect(await response.text()).toBe("row-1\nrow-2\n");
      expect(slot.released).toBe(1);
    });
  });

  describe("given the sizing query fails after the slot was taken", () => {
    it("releases the slot before the refusal travels", async () => {
      const { bounds, slot } = boundsFake();
      const { download, exportService } = buildApi({ bounds });
      vi.mocked(exportService.getTotalCount).mockRejectedValueOnce(new Error("ClickHouse down"));

      const response = await download();

      expect(response.status).toBe(500);
      expect(slot.released).toBe(1);
      expect(exportService.exportTraces).not.toHaveBeenCalled();
    });
  });
});
