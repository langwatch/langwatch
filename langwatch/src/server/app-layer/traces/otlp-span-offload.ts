import type { OtlpKeyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { BlobStore } from "./blob-store.service";
import { BLOB_REF_ATTR_PREFIX } from "./blob-ref-attributes";
import {
  utf8Preview,
  DEFAULT_OFFLOAD_THRESHOLD_BYTES,
  DEFAULT_PREVIEW_BYTES,
} from "./span-field-offload.service";

/**
 * Edge offload over the raw OTLP attribute shape (`{key, value:{stringValue}}[]`).
 * Runs at ingestion, before the span is staged — so the over-threshold value is
 * gone from every downstream copy (queue job, fold cache, event log,
 * stored_spans, trace_summaries). The full value goes to object storage; the
 * inline `stringValue` becomes a bounded preview, and a reserved
 * `langwatch.reserved.blobref.<key>` attribute carries the ref. ADR-021 / #4215.
 *
 * Only `stringValue` attributes over the threshold are touched; everything else
 * (small strings, non-string AnyValues) passes through unchanged. Returns a new
 * attribute array (does not mutate the input).
 */
export async function offloadOtlpSpanAttributes({
  attributes,
  projectId,
  traceId,
  spanId,
  blobStore,
  thresholdBytes = DEFAULT_OFFLOAD_THRESHOLD_BYTES,
  previewBytes = DEFAULT_PREVIEW_BYTES,
}: {
  attributes: OtlpKeyValue[];
  projectId: string;
  traceId: string;
  spanId: string;
  blobStore: BlobStore;
  thresholdBytes?: number;
  previewBytes?: number;
}): Promise<OtlpKeyValue[]> {
  const kept: OtlpKeyValue[] = [];
  const refAttrs: OtlpKeyValue[] = [];
  let droppedReserved = false;

  for (const kv of attributes) {
    // The reserved blob-ref namespace is server-owned. Drop any client-supplied
    // entry with a reserved key before any other processing — a malicious client
    // must not be able to inject a forged ref that would later be resolved and
    // serve another project's blob to the attacker. CR-2 (#4215).
    if (kv.key.startsWith(BLOB_REF_ATTR_PREFIX)) {
      droppedReserved = true;
      continue;
    }

    const value = kv.value?.stringValue;
    if (
      typeof value === "string" &&
      Buffer.byteLength(value, "utf-8") > thresholdBytes
    ) {
      const ref = await blobStore.put({
        projectId,
        traceId,
        spanId,
        attrKey: kv.key,
        value,
      });
      kept.push({
        ...kv,
        value: { ...kv.value, stringValue: utf8Preview(value, previewBytes) },
      });
      refAttrs.push({
        key: `${BLOB_REF_ATTR_PREFIX}${kv.key}`,
        value: { stringValue: JSON.stringify(ref) },
      });
    } else {
      kept.push(kv);
    }
  }

  // Return original array only when nothing changed (no offloads, no stripped
  // reserved keys) — preserves the reference-equality fast-path used by callers.
  if (refAttrs.length === 0 && !droppedReserved) return attributes;
  return [...kept, ...refAttrs];
}
