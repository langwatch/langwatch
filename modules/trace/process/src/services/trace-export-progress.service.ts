import { createLogger } from "@langwatch/observability";
import { exportProgressEventSchema, type ExportProgressEvent } from "@langwatch/trace-contract";

import type { TraceTenantUpdateStreamService } from "./trace-tenant-update-stream.service.ts";

const logger = createLogger("langwatch:api:export");

/**
 * Relays one export's frames off the tenant's `export_progress` broadcast (port of
 * main's `export` router). The channel is per tenant, so the exportId separates exports.
 */
export class TraceExportProgressService {
  private constructor(private readonly updates: TraceTenantUpdateStreamService) {}

  static create({
    updates,
  }: {
    updates: TraceTenantUpdateStreamService;
  }): TraceExportProgressService {
    return new TraceExportProgressService(updates);
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
    logger.info({ projectId, exportId }, "Export progress subscription started");

    for await (const envelope of this.updates.watch({
      projectId,
      eventName: "export_progress",
      signal,
    })) {
      const frame = exportProgressEventSchema.safeParse(parseEnvelope(envelope));
      if (!frame.success) {
        logger.warn({ projectId, exportId }, "Ignoring invalid export progress event");
        continue;
      }
      if (frame.data.exportId !== exportId) continue;

      yield frame.data;

      if (frame.data.type === "done" || frame.data.type === "error") break;
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
