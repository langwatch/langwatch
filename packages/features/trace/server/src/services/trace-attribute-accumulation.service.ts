import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE,
  TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE,
} from "../ports/trace-media-reference.port";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { parseJsonStringArray, stringAttr } from "./trace-summary-attributes.rules";
import { TraceOriginService } from "./trace-origin.service";
import { TraceAttributeExtractionService } from "./trace-attribute-extraction.service";

/**
 * Trace-level model metadata stamped by the fold from the models its spans
 * (or log turns) actually used. Semantic:
 *
 *   - `metadata.model`  is the trace's PRIMARY model: `models[0]`, i.e. the
 *     model of the most recently folded LLM span / log turn (the same
 *     "primary model" every `models[0]` consumer in the UI shows). Single
 *     value for single-value consumers (filters, dataset mappings,
 *     `trace.metadata.model` on the API).
 *   - `metadata.models` is a JSON array of ALL models seen on the trace,
 *     most-recently-used first (same order as the `Models` column).
 *
 * Stamped keys live in the `metadata.*` namespace so they surface through the
 * regular metadata read path and stay filterable. USER-PROVIDED values win:
 * the fold only stamps when the keys are absent, or when the reserved marker
 * says a previous fold stamped them (so the stamp can track new models as
 * later spans arrive without ever clobbering explicit user metadata).
 */
export const STAMPED_MODEL_ATTRIBUTE = "metadata.model";
export const STAMPED_MODELS_ATTRIBUTE = "metadata.models";
export const MODEL_METADATA_STAMPED_MARKER = "langwatch.reserved.model_metadata_stamped";

/**
 * Extracts per-span attributes and merges them into trace-level attributes,
 * handling labels union, prompt ID collection, metadata deep-merge,
 * origin hoisting, and PII redaction tracking.
 */
export class TraceAttributeAccumulationService {
  private constructor(
    private readonly traceOriginService: TraceOriginService,
    private readonly extraction: TraceAttributeExtractionService,
  ) {}

  static create(traceOriginService: TraceOriginService): TraceAttributeAccumulationService {
    // Extraction takes no dependencies, so it is built here rather than made a
    // parameter every caller would have to thread through unchanged.
    return new TraceAttributeAccumulationService(
      traceOriginService,
      TraceAttributeExtractionService.create(),
    );
  }

  accumulateAttributes({
    state,
    span,
    outputSource,
    inputIsFallback,
    outputIsFallback,
    inputMediaRefs,
    outputMediaRefs,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    outputSource: string;
    inputIsFallback: boolean;
    outputIsFallback: boolean;
    /** Compact JSON media refs following the winning IO, or null to clear. */
    inputMediaRefs: string | null;
    outputMediaRefs: string | null;
  }): Record<string, string> {
    const spanAttrs = this.extraction.extractAttributes(span);
    // State wins on a plain key: the first span to set one keeps it. The steps
    // below are the exceptions, each for its own reason.
    const merged = { ...spanAttrs, ...state.attributes };

    this.unionLabels({ merged, spanAttrs, state });
    this.unionPromptIds({ merged, spanAttrs, state });
    this.mergeMetadataObjects({ merged, spanAttrs, state });
    this.preferUserModelMetadata({ merged, spanAttrs });

    this.traceOriginService.stripLegacyMarkers(merged);
    this.traceOriginService.hoistOrigin({ state, span, mergedAttributes: merged });
    this.traceOriginService.hoistSource({ state, span, mergedAttributes: merged });

    this.applyReservedFlags({ merged, outputSource, inputIsFallback, outputIsFallback });
    this.recordMediaAndRedaction({ merged, span, inputMediaRefs, outputMediaRefs });

    return merged;
  }

  /** Labels are a set across the whole trace, not the last span's list. */
  private unionLabels({
    merged,
    spanAttrs,
    state,
  }: {
    merged: Record<string, string>;
    spanAttrs: Record<string, string>;
    state: TraceSummaryData;
  }): void {
    // Labels: union across spans
    const existingLabels = state.attributes["langwatch.labels"];
    const newLabels = spanAttrs["langwatch.labels"];
    if (existingLabels || newLabels) {
      const union = [
        ...new Set([...parseJsonStringArray(existingLabels), ...parseJsonStringArray(newLabels)]),
      ];
      if (union.length > 0) {
        merged["langwatch.labels"] = JSON.stringify(union);
      }
    }
  }

  /**
   * Prompt ids likewise, gathered under a plural key. The per-span key is
   * dropped so it cannot leak out as a trace-level attribute.
   */
  private unionPromptIds({
    merged,
    spanAttrs,
    state,
  }: {
    merged: Record<string, string>;
    spanAttrs: Record<string, string>;
    state: TraceSummaryData;
  }): void {
    // Prompt IDs: union across spans
    const existingPromptIds = state.attributes["langwatch.prompt_ids"];
    const newPromptId = spanAttrs["langwatch.prompt.id"];
    if (existingPromptIds || newPromptId) {
      const union = [
        ...new Set([
          ...parseJsonStringArray(existingPromptIds),
          ...(newPromptId ? [newPromptId] : []),
        ]),
      ];
      if (union.length > 0) {
        merged["langwatch.prompt_ids"] = JSON.stringify(union);
      }
    }

    // Remove the per-span key so it doesn't leak into trace-level attributes
    delete merged["langwatch.prompt.id"];
  }

  /**
   * Two spans may each carry part of one `metadata.*` object. Deep-merge those,
   * with the earlier span winning per key; anything that is not JSON keeps the
   * plain first-wins result.
   */
  private mergeMetadataObjects({
    merged,
    spanAttrs,
    state,
  }: {
    merged: Record<string, string>;
    spanAttrs: Record<string, string>;
    state: TraceSummaryData;
  }): void {
    // Metadata: deep-merge JSON objects, first-wins for primitives
    for (const key of Object.keys(merged)) {
      if (!key.startsWith("metadata.")) {
        continue;
      }
      const prev = state.attributes[key];
      const next = spanAttrs[key];
      if (!prev || !next) {
        continue;
      }
      try {
        const prevObj: unknown = JSON.parse(prev);
        const nextObj: unknown = JSON.parse(next);
        if (
          typeof prevObj === "object" &&
          prevObj &&
          !Array.isArray(prevObj) &&
          typeof nextObj === "object" &&
          nextObj &&
          !Array.isArray(nextObj)
        ) {
          merged[key] = JSON.stringify({ ...nextObj, ...prevObj });
        }
      } catch {
        /* not JSON - keep first-wins */
      }
    }
  }

  /**
   * A user's own `metadata.model` beats a stamp an earlier fold applied.
   *
   * First-wins would otherwise keep OUR stamped value and silently discard
   * what the caller sent, so the incoming keys are applied and the marker
   * cleared for good. The stamp never reaches here through `spanAttrs`: it
   * lives on state, and `extractAttributes` reads the span.
   */
  private preferUserModelMetadata({
    merged,
    spanAttrs,
  }: {
    merged: Record<string, string>;
    spanAttrs: Record<string, string>;
  }): void {
    // User-provided model metadata wins over an earlier fold's stamp. The
    // existing-wins merge above keeps the STAMPED values when a later span
    // carries user `metadata.model` / `metadata.models`, which would silently
    // drop the user's value. Apply the incoming user keys and clear the
    // marker so stamping stops for good. (Our own stamp never appears in
    // spanAttrs: extractAttributes reads the span, the stamp lives on state.)
    if (merged[MODEL_METADATA_STAMPED_MARKER] === "true") {
      const incomingModel = spanAttrs[STAMPED_MODEL_ATTRIBUTE];
      const incomingModels = spanAttrs[STAMPED_MODELS_ATTRIBUTE];
      if (incomingModel !== undefined || incomingModels !== undefined) {
        delete merged[MODEL_METADATA_STAMPED_MARKER];
        if (incomingModel !== undefined) {
          merged[STAMPED_MODEL_ATTRIBUTE] = incomingModel;
        } else {
          delete merged[STAMPED_MODEL_ATTRIBUTE];
        }

        if (incomingModels !== undefined) {
          merged[STAMPED_MODELS_ATTRIBUTE] = incomingModels;
        } else {
          delete merged[STAMPED_MODELS_ATTRIBUTE];
        }
      }
    }
  }

  /** Reserved flags are set or removed, never left stale from an earlier span. */
  private applyReservedFlags({
    merged,
    outputSource,
    inputIsFallback,
    outputIsFallback,
  }: {
    merged: Record<string, string>;
    outputSource: string;
    inputIsFallback: boolean;
    outputIsFallback: boolean;
  }): void {
    merged["langwatch.reserved.output_source"] = outputSource;
    if (inputIsFallback) {
      merged["langwatch.reserved.input_is_fallback"] = "true";
    } else {
      delete merged["langwatch.reserved.input_is_fallback"];
    }

    if (outputIsFallback) {
      merged["langwatch.reserved.output_is_fallback"] = "true";
    } else {
      delete merged["langwatch.reserved.output_is_fallback"];
    }
  }

  /**
   * Media refs ride the summary so the trace list and drawer can render
   * thumbnails without reloading span payloads, following the same winner as
   * the computed text. Redaction status accumulates span ids by severity.
   */
  private recordMediaAndRedaction({
    merged,
    span,
    inputMediaRefs,
    outputMediaRefs,
  }: {
    merged: Record<string, string>;
    span: NormalizedSpan;
    inputMediaRefs: string | null;
    outputMediaRefs: string | null;
  }): void {
    // Media refs ride the summary so the trace list and drawer summary can
    // render thumbnails/players without reloading span payloads. They follow
    // the same winner as ComputedInput/Output (see TraceIOAccumulationService).
    if (inputMediaRefs) {
      merged[TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE] = inputMediaRefs;
    } else {
      delete merged[TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE];
    }

    if (outputMediaRefs) {
      merged[TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE] = outputMediaRefs;
    } else {
      delete merged[TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE];
    }

    // PII redaction status tracking - accumulate span IDs by severity
    const piiStatus = span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS];
    if (piiStatus === "partial" || piiStatus === "none") {
      const key =
        piiStatus === "partial"
          ? ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS
          : ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS;
      const ids = parseJsonStringArray(merged[key]);
      ids.push(span.spanId);
      merged[key] = JSON.stringify(ids);
    }
  }

  /**
   * Stamp the trace-level model metadata (`metadata.model` primary +
   * `metadata.models` set) from the models accumulated so far. See
   * {@link STAMPED_MODEL_ATTRIBUTE} for the exact semantic. Mutates the map.
   *
   * The fold calls this AFTER attribute accumulation with the merged models
   * list, so the stamp tracks each newly seen model. User-provided
   * `metadata.model` / `metadata.models` (span or resource metadata) win: the
   * reserved marker records that WE stamped the current values, and without
   * it a present value is treated as the user's and left untouched. A user
   * value arriving only on a LATER span, after a fold has already stamped,
   * also wins: `accumulateAttributes` detects the incoming user key, applies
   * it over the stamp, and clears the marker so stamping stops for good.
   */
  stampModelMetadata({
    attributes,
    models,
  }: {
    attributes: Record<string, string>;
    models: string[];
  }): void {
    if (models.length === 0) {
      return;
    }
    const stampedByUs = attributes[MODEL_METADATA_STAMPED_MARKER] === "true";
    const userProvided =
      !stampedByUs &&
      (attributes[STAMPED_MODEL_ATTRIBUTE] !== undefined ||
        attributes[STAMPED_MODELS_ATTRIBUTE] !== undefined);
    if (userProvided) {
      return;
    }
    attributes[STAMPED_MODEL_ATTRIBUTE] = models[0]!;
    attributes[STAMPED_MODELS_ATTRIBUTE] = JSON.stringify(models);
    attributes[MODEL_METADATA_STAMPED_MARKER] = "true";
  }
}
