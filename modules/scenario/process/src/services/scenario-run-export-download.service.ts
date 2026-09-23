import { Readable } from "node:stream";
import { createGzip } from "node:zlib";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";
import type {
  ScenarioRunExportDownload,
  ScenarioRunExportDownloadInput,
} from "@langwatch/scenario-contract";
import { format, nowInstant } from "@langwatch/time";

import type { ScenarioRunExportService } from "./scenario-run-export.service.ts";

const logger = createLogger("langwatch:scenario-run-export-download");

function downloadFilename(request: ScenarioRunExportDownloadInput["request"]): string {
  const today = format(nowInstant().epochMilliseconds, "yyyy-MM-dd", { timeZone: "UTC" });
  const projectId = request.projectId.replace(/[^\w.-]/g, "_");

  return `${projectId} - Scenario Runs - ${today} - ${request.mode}.csv`;
}

/** Owns an export's audit entry, progress fan-out, compression, and cancellation. */
export class ScenarioRunExportDownloadService {
  static create(input: {
    auditLog: AuditLogApi;
    exports: ScenarioRunExportService;
    presence: PresenceApi;
  }): ScenarioRunExportDownloadService {
    return new ScenarioRunExportDownloadService(input);
  }

  readonly #auditLog: AuditLogApi;
  readonly #exports: ScenarioRunExportService;
  readonly #presence: PresenceApi;

  private constructor(input: {
    auditLog: AuditLogApi;
    exports: ScenarioRunExportService;
    presence: PresenceApi;
  }) {
    this.#auditLog = input.auditLog;
    this.#exports = input.exports;
    this.#presence = input.presence;
  }

  async download(input: ScenarioRunExportDownloadInput): Promise<ScenarioRunExportDownload> {
    input.signal?.throwIfAborted();

    const { request, userId } = input;
    await this.#auditLog.record({
      userId,
      projectId: request.projectId,
      action: "scenarioRuns.export",
      targetKind: "project",
      targetId: request.projectId,
      args: {
        mode: request.mode,
        ...(request.scenarioSetId === undefined ? {} : { scenarioSetId: request.scenarioSetId }),
        ...(request.scenarioId === undefined ? {} : { scenarioId: request.scenarioId }),
        ...(request.passFailStatus === undefined ? {} : { passFailStatus: request.passFailStatus }),
        ...(request.startDate === undefined ? {} : { startDate: request.startDate }),
        ...(request.endDate === undefined ? {} : { endDate: request.endDate }),
      },
    });

    const exportId = crypto.randomUUID();
    const totalCount = await this.#exports.getTotalCount({ request });
    input.signal?.throwIfAborted();

    const controller = new AbortController();
    const cancelFromRequest = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", cancelFromRequest, { once: true });
    if (input.signal?.aborted) {
      input.signal.removeEventListener("abort", cancelFromRequest);
      input.signal.throwIfAborted();
    }

    const source = Readable.from(
      this.#stream({
        request,
        exportId,
        totalCount,
        signal: controller.signal,
        onFinished: () => input.signal?.removeEventListener("abort", cancelFromRequest),
      }),
    );
    const gzip = createGzip();
    source.on("error", (error) => gzip.destroy(error));
    source.pipe(gzip);

    return {
      exportId,
      filename: downloadFilename(request),
      totalCount,
      stream: gzip,
      cancel: async (reason) => {
        controller.abort(reason);
        source.destroy();
        gzip.destroy();
        input.signal?.removeEventListener("abort", cancelFromRequest);
      },
    };
  }

  async *#stream(input: {
    request: ScenarioRunExportDownloadInput["request"];
    exportId: string;
    totalCount: number;
    signal: AbortSignal;
    onFinished: () => void;
  }): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    const publish = (event: Record<string, unknown>) => {
      void this.#presence
        .publishProjectEvent({
          projectId: input.request.projectId,
          channel: "export_progress",
          event: JSON.stringify({ exportId: input.exportId, ...event }),
        })
        .catch((error: unknown) => {
          logger.warn(
            { error, projectId: input.request.projectId },
            "Export progress publish failed",
          );
        });
    };

    try {
      for await (const { chunk, progress } of this.#exports.exportRuns({
        request: input.request,
        signal: input.signal,
        total: input.totalCount,
      })) {
        publish({ type: "progress", exported: progress.exported, total: progress.total });
        yield encoder.encode(chunk);
      }
      publish({ type: "done" });
    } catch (error) {
      logger.error(
        { error, projectId: input.request.projectId },
        "Scenario run export stream error",
      );
      publish({ type: "error", message: "Export failed" });
      throw error;
    } finally {
      input.onFinished();
    }
  }
}
