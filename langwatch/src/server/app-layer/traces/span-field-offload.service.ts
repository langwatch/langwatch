import type { BlobStore, TraceBlobRef } from "./blob-store.service";

/** Default per-field offload threshold. Matches ADR-017's gateway cap (32 KB). */
export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 32 * 1024;
/** Bounded preview kept inline in place of an offloaded value. */
export const DEFAULT_PREVIEW_BYTES = 2 * 1024;

export interface SpanFieldOffloadResult {
  /** Attributes with over-threshold string values replaced by a bounded preview. */
  attributes: Record<string, string>;
  /** attrKey → blob reference, for the values that were offloaded. */
  blobRefs: Record<string, TraceBlobRef>;
}

/** UTF-8-safe truncation to at most `maxBytes`, backing off to a char boundary. */
export function utf8Preview(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf-8");
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8") + "…";
}

/**
 * Replaces over-threshold span field values with a bounded preview, storing the
 * full value in object storage via {@link BlobStore}. The returned `{preview +
 * ref}` is what flows through the rest of the pipeline (queue job, fold cache,
 * ClickHouse), keeping every downstream copy small. See ADR-021 / issue #4215.
 *
 * Runs at the edge (ingestion), so it shrinks ALL downstream copies at once.
 */
export class SpanFieldOffloadService {
  private readonly thresholdBytes: number;
  private readonly previewBytes: number;

  constructor(
    private readonly blobStore: BlobStore,
    options?: { thresholdBytes?: number; previewBytes?: number },
  ) {
    this.thresholdBytes =
      options?.thresholdBytes ?? DEFAULT_OFFLOAD_THRESHOLD_BYTES;
    this.previewBytes = options?.previewBytes ?? DEFAULT_PREVIEW_BYTES;
  }

  async offload({
    projectId,
    traceId,
    spanId,
    attributes,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    attributes: Record<string, string>;
  }): Promise<SpanFieldOffloadResult> {
    const out: Record<string, string> = {};
    const blobRefs: Record<string, TraceBlobRef> = {};

    for (const [attrKey, value] of Object.entries(attributes)) {
      if (Buffer.byteLength(value, "utf-8") > this.thresholdBytes) {
        const ref = await this.blobStore.put({
          projectId,
          traceId,
          spanId,
          attrKey,
          value,
        });
        out[attrKey] = utf8Preview(value, this.previewBytes);
        blobRefs[attrKey] = ref;
      } else {
        out[attrKey] = value;
      }
    }

    return { attributes: out, blobRefs };
  }
}
