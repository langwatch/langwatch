import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import {
  ExportFailedError,
  type TraceExportDownload,
  type TraceExportDownloadInput,
} from "@langwatch/trace-contract";

import type { TraceExportBounds, TraceExportSlot } from "./trace-export-bounds.service.ts";
import type { TraceExportService } from "./trace-export.service.ts";
import type { TraceViewerProtectionService } from "./trace-viewer-protection.service.ts";

const logger = createLogger("langwatch:trace-export-download");

/** Composes one export's budget, viewer redactions, stream and tenant progress signals. */
export class TraceExportDownloadService {
  static create(input: {
    exports: TraceExportService;
    protections: TraceViewerProtectionService;
    bounds: TraceExportBounds;
    presence: PresenceApi;
  }): TraceExportDownloadService {
    return new TraceExportDownloadService(input);
  }

  readonly #exports: TraceExportService;
  readonly #protections: TraceViewerProtectionService;
  readonly #bounds: TraceExportBounds;
  readonly #presence: PresenceApi;

  private constructor(input: {
    exports: TraceExportService;
    protections: TraceViewerProtectionService;
    bounds: TraceExportBounds;
    presence: PresenceApi;
  }) {
    this.#exports = input.exports;
    this.#protections = input.protections;
    this.#bounds = input.bounds;
    this.#presence = input.presence;
  }

  async download(input: TraceExportDownloadInput): Promise<TraceExportDownload> {
    const { request, userId } = input;
    await this.#bounds.assertExportWithinRate({ projectId: request.projectId });
    const protections = await this.#protections.resolve({
      projectId: request.projectId,
      userId,
      publiclyShared: false,
    });
    const exportId = crypto.randomUUID();
    const slot = await this.#bounds.acquireExportSlot({ projectId: request.projectId, exportId });
    const lease = TraceExportDownloadLease.create(slot);

    try {
      const totalCount = await this.#exports.getTotalCount({ request, protections });
      return {
        exportId,
        totalCount,
        stream: this.#stream({ request, protections, exportId, lease }),
        cancel: () => lease.release(),
      };
    } catch (error) {
      await lease.release();
      if (HandledError.isHandled(error)) throw error;
      throw new ExportFailedError(error);
    }
  }

  async *#stream(input: {
    request: TraceExportDownloadInput["request"];
    protections: Awaited<ReturnType<TraceViewerProtectionService["resolve"]>>;
    exportId: string;
    lease: TraceExportDownloadLease;
  }): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    const publish = (event: Record<string, unknown>) => {
      void this.#presence
        .publishProjectEvent({
          projectId: input.request.projectId,
          channel: "export_progress",
          event: JSON.stringify(event),
        })
        .catch((error: unknown) => {
          logger.warn(
            { error, projectId: input.request.projectId },
            "Export progress publish failed",
          );
        });
    };

    try {
      for await (const { chunk, progress } of this.#exports.exportTraces({
        request: input.request,
        protections: input.protections,
      })) {
        publish({
          exportId: input.exportId,
          type: "progress",
          exported: progress.exported,
          total: progress.total,
        });
        yield encoder.encode(chunk);
      }
      publish({ exportId: input.exportId, type: "done" });
    } catch (error) {
      logger.error({ error, projectId: input.request.projectId }, "Export stream error");
      publish({ exportId: input.exportId, type: "error", message: "Export failed" });
      throw error;
    } finally {
      await input.lease.release();
    }
  }
}

/** The download stream and the HTTP door may each release; the storage key is freed once. */
class TraceExportDownloadLease {
  static create(slot: TraceExportSlot): TraceExportDownloadLease {
    return new TraceExportDownloadLease(slot);
  }

  #released = false;
  #slot: TraceExportSlot;

  private constructor(slot: TraceExportSlot) {
    this.#slot = slot;
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#slot.release();
  }
}
