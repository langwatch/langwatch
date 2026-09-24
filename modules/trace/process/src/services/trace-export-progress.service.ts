import { on } from "node:events";

import { createLogger } from "@langwatch/observability";
import { exportProgressEventSchema, type ExportProgressEvent } from "@langwatch/trace-contract";

import type { TracesTrpcEmitters } from "#app/trace.app";

const logger = createLogger("langwatch:api:export");

/**
 * Relays one export's frames off the tenant's `export_progress` broadcast (port of
 * main's `export` router). The channel is per tenant, so the exportId separates exports.
 */
export class TraceExportProgressService {
  private constructor(private readonly broadcast: TracesTrpcEmitters) {}

  static create({ broadcast }: { broadcast: TracesTrpcEmitters }): TraceExportProgressService {
    return new TraceExportProgressService(broadcast);
  }

  async *stream({
    projectId,
    exportId,
    signal,
  }: {
    projectId: string;
    exportId: string;
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<ExportProgressEvent> {
    const emitter = this.broadcast.getTenantEmitter(projectId);
    logger.info({ projectId, exportId }, "Export progress subscription started");

    try {
      for await (const eventArgs of on(emitter, "export_progress", { signal })) {
        const frame = exportProgressEventSchema.safeParse(parseEnvelope(eventArgs[0]));
        if (!frame.success) {
          logger.warn({ projectId, exportId }, "Ignoring invalid export progress event");
          continue;
        }
        if (frame.data.exportId !== exportId) continue;

        yield frame.data;

        if (frame.data.type === "done" || frame.data.type === "error") break;
      }
    } finally {
      this.broadcast.cleanupTenantEmitter(projectId);
    }
  }
}

/** The broadcast envelope's JSON payload; anything unreadable fails the schema parse after it. */
function parseEnvelope(raw: unknown): unknown {
  const event = raw !== null && typeof raw === "object" && "event" in raw ? raw.event : void 0;
  if (typeof event !== "string") return event;
  try {
    return JSON.parse(event);
  } catch {
    return event;
  }
}
