import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { SpanData } from "../schemas/commands";
import { SpanAttributeExtractionUtils } from "../utils/spanAttributeExtraction.utils";

const { extractString, extractStringArray } = SpanAttributeExtractionUtils;

/**
 * Trace-level attributes extracted from spans.
 */
export interface TraceAttributes {
  threadId: string | null;
  userId: string | null;
  customerId: string | null;
  labels: string[];
  sdkName: string | null;
  sdkVersion: string | null;
  sdkLanguage: string | null;
  promptIds: string[];
  promptVersionIds: string[];
  selectedPromptId: string | null;
}

/**
 * Service for extracting trace-level attributes from stored spans.
 *
 * NOTE: This runs AFTER span processing, so attributes are already in canonical form:
 * - `gen_ai.conversation.id` (converted from `langwatch.thread.id`)
 * - `langwatch.user.id`, `langwatch.customer.id`, `langwatch.labels`
 * - `telemetry.sdk.*` from resource attributes
 * - `langwatch.prompt.*` for prompt tracking
 *
 * @example
 * ```typescript
 * const attrs = traceAttributesService.extract(spans);
 * console.log(attrs.userId, attrs.threadId);
 * ```
 */
export class TraceAttributesService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.attributes",
  );

  /**
   * Extracts trace-level attributes from spans.
   * Later spans take precedence for singular values.
   */
  extract(spans: SpanData[]): TraceAttributes {
    return this.tracer.withActiveSpan(
      "TraceAttributesService.extract",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "span.count": spans.length },
      },
      (otelSpan) => {
        const attrs: TraceAttributes = {
          threadId: null,
          userId: null,
          customerId: null,
          labels: [],
          sdkName: null,
          sdkVersion: null,
          sdkLanguage: null,
          promptIds: [],
          promptVersionIds: [],
          selectedPromptId: null,
        };

        const labelsSet = new Set<string>();
        const promptIdsSet = new Set<string>();
        const promptVersionIdsSet = new Set<string>();

        for (const span of spans) {
          const spanAttrs = span.attributes ?? {};

          // Thread ID (canonical form after span processing)
          const threadId = extractString(spanAttrs, "gen_ai.conversation.id");
          if (threadId) attrs.threadId = threadId;

          // User ID
          const userId = extractString(spanAttrs, "langwatch.user.id");
          if (userId) attrs.userId = userId;

          // Customer ID
          const customerId = extractString(spanAttrs, "langwatch.customer.id");
          if (customerId) attrs.customerId = customerId;

          // Labels
          for (const label of extractStringArray(
            spanAttrs,
            "langwatch.labels",
          )) {
            labelsSet.add(label);
          }

          // SDK info from resource attributes (first wins)
          const resourceAttrs = span.resourceAttributes ?? {};
          attrs.sdkName ??= extractString(resourceAttrs, "telemetry.sdk.name");
          attrs.sdkVersion ??= extractString(
            resourceAttrs,
            "telemetry.sdk.version",
          );
          attrs.sdkLanguage ??= extractString(
            resourceAttrs,
            "telemetry.sdk.language",
          );

          // Prompt IDs
          const promptId = extractString(spanAttrs, "langwatch.prompt.id");
          if (promptId) promptIdsSet.add(promptId);

          const promptVersionId = extractString(
            spanAttrs,
            "langwatch.prompt.version.id",
          );
          if (promptVersionId) promptVersionIdsSet.add(promptVersionId);

          const selectedPromptId = extractString(
            spanAttrs,
            "langwatch.prompt.selected.id",
          );
          if (selectedPromptId) attrs.selectedPromptId = selectedPromptId;
        }

        // Convert sets to sorted arrays
        attrs.labels = Array.from(labelsSet).sort();
        attrs.promptIds = Array.from(promptIdsSet).sort();
        attrs.promptVersionIds = Array.from(promptVersionIdsSet).sort();

        otelSpan.setAttributes({
          "attrs.has_thread_id": attrs.threadId !== null,
          "attrs.has_user_id": attrs.userId !== null,
          "attrs.label_count": attrs.labels.length,
          "attrs.sdk_name": attrs.sdkName ?? "unknown",
        });

        return attrs;
      },
    );
  }
}

export const traceAttributesService = new TraceAttributesService();
