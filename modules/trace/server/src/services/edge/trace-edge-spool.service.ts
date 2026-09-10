import type { Logger } from "@langwatch/observability";
import { COMMAND_INLINE_THRESHOLD, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { TraceIngressPayloadPort } from "../ingestion/trace-ingestion.service.ts";
import type { TraceSpoolService } from "../ingestion/trace-spool.service.ts";

/**
 * The write half of the ADR-022 claim check: the edge size check, and the
 * transient spool of an over-threshold command payload. The queued command
 * carries only the reference the worker reads back.
 */

// FAIL-OPEN, deliberately. This is oversize PROTECTION, not the durability
// boundary, so an unreachable spool degrades to the inline route rather than
// refusing the span. The warning names what was skipped.
export class TraceEdgeSpoolService extends TraceIngressPayloadPort {
  static create(options: {
    spool: Pick<TraceSpoolService, "putSpool">;
    logger: Logger;
  }): TraceEdgeSpoolService {
    return new TraceEdgeSpoolService(options);
  }

  private constructor(
    private readonly options: {
      spool: Pick<TraceSpoolService, "putSpool">;
      logger: Logger;
    },
  ) {
    super();
  }

  async prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const serialized = JSON.stringify(data);
    const byteLength = Buffer.byteLength(serialized, "utf8");
    if (byteLength <= COMMAND_INLINE_THRESHOLD) {
      return data;
    }

    const projectId = data.tenantId;
    const traceId = String(data.span.traceId);
    const spanId = String(data.span.spanId);

    try {
      const spoolRef = await this.options.spool.putSpool({
        projectId,
        traceId,
        spanId,
        // The body is the command as the worker will read it back, so the
        // string already computed for the size check is the body.
        body: Buffer.from(serialized, "utf8"),
      });

      // The attributes are what made it oversized and they are in the spool
      // object now; leaving them on the command would defeat the whole check.
      return { ...data, spoolRef, span: { ...data.span, attributes: [] } };
    } catch (error) {
      this.options.logger.warn(
        { error, projectId, traceId, spanId, byteLength },
        "oversize protection skipped; queue carries full payload",
      );

      return data;
    }
  }
}
