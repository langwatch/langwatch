import { SpanKind } from "@opentelemetry/api";
import {
  StoredObjectOwnerLookupTelemetryPort,
  type StoredObjectOwnerLookupSpan,
} from "@langwatch/stored-object-server";
import { getLangWatchTracer } from "langwatch";

/** App-owned tracing adapter for the legacy cross-tenant file-owner lookup. */
export class AppStoredObjectOwnerLookupTracingAdapter extends StoredObjectOwnerLookupTelemetryPort {
  static create(): AppStoredObjectOwnerLookupTracingAdapter {
    return new AppStoredObjectOwnerLookupTracingAdapter();
  }

  private readonly tracer = getLangWatchTracer("langwatch.stored-objects.cross-tenant-lookup");

  async withLookupSpan<Result>(
    input: { id: string },
    operation: (span: StoredObjectOwnerLookupSpan) => Promise<Result>,
  ): Promise<Result> {
    return await this.tracer.withActiveSpan(
      "StoredObjects.resolveStoredObjectOwner",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "stored_object.id": input.id,
        },
      },
      operation,
    );
  }
}
