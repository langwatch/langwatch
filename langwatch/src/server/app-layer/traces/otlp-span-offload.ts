import type { OtlpKeyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { BlobStore } from "./blob-store.service";
import { BLOB_REF_ATTR_PREFIX } from "./blob-ref-attributes";
import {
  utf8Preview,
  DEFAULT_OFFLOAD_THRESHOLD_BYTES,
  DEFAULT_PREVIEW_BYTES,
  IO_PREVIEW_BYTES,
  IO_ATTR_KEYS,
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
 *
 * All over-threshold fields are batched into ONE `BlobStore.put` call per span,
 * producing a single manifest object in S3 and eliminating the previous 3–5×
 * per-field PUT cost. ADR-021 / #4215 (Concern 3).
 *
 * Preview budget is differential per Drew's design:
 * - IO attributes (langwatch.input/output, gen_ai.input/output.messages) use
 *   IO_PREVIEW_BYTES (32 KB = threshold) so ComputedInput/Output stays fully
 *   searchable for sub-threshold values and covers the first 32 KB of offloaded
 *   ones. ADR-021 / #4215 (Concern 2).
 * - All other attributes keep the 2 KB DEFAULT_PREVIEW_BYTES default.
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
  // Fields that exceeded the threshold — collected BEFORE the single put call.
  const overThresholdFields: Record<string, string> = {};
  // Per-attribute preview values, to be spliced into `kept` after the put.
  const previewByKey: Record<string, string> = {};
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
      // Pick the IO-extended preview budget for canonical IO attributes;
      // everything else uses the caller-supplied default. ADR-021 Concern 2.
      const budget = IO_ATTR_KEYS.has(kv.key) ? IO_PREVIEW_BYTES : previewBytes;
      overThresholdFields[kv.key] = value;
      previewByKey[kv.key] = utf8Preview(value, budget);
      kept.push({
        ...kv,
        value: { ...kv.value, stringValue: previewByKey[kv.key] },
      });
    } else {
      kept.push(kv);
    }
  }

  const offloadedKeys = Object.keys(overThresholdFields);

  // Return original array only when nothing changed (no offloads, no stripped
  // reserved keys) — preserves the reference-equality fast-path used by callers.
  if (offloadedKeys.length === 0 && !droppedReserved) return attributes;

  if (offloadedKeys.length === 0) {
    // Only reserved keys were stripped — no S3 write needed.
    return kept;
  }

  // ONE put call for all over-threshold fields in this span. ADR-021 Concern 3.
  const refs = await blobStore.put({
    projectId,
    traceId,
    spanId,
    fields: overThresholdFields,
  });

  // Append one reserved ref attribute per offloaded field.
  const refAttrs: OtlpKeyValue[] = offloadedKeys.map((attrKey) => ({
    key: `${BLOB_REF_ATTR_PREFIX}${attrKey}`,
    value: { stringValue: JSON.stringify(refs[attrKey]) },
  }));

  return [...kept, ...refAttrs];
}
