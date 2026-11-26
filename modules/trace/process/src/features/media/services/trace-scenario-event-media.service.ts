import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import { coerceContentToArray } from "../../conversation/rules/trace-content-array.rules.ts";
import {
  type ExtractedRef,
  TraceMediaExtractionService,
} from "./trace-media-extraction.service.ts";
import { SCENARIO_EVENT_MEDIA, TraceMediaStoreService } from "./trace-media-store.service.ts";

const tracer = getLangWatchTracer("langwatch.stored-objects.content-extractor");

type EventParams = Readonly<{ projectId: string; ownerId: string }>;

/**
 * Trace's scenario-event media operation: inline media in the event's message content is stored
 * for the run and rewritten by reference. A store failure rejects the whole event (see the
 * scenario externalisation spec); the span walker's per-part fail-open is not applied here yet.
 */
export class TraceScenarioEventMediaService {
  static create(storedObjects: StoredObjectApi): TraceScenarioEventMediaService {
    return new TraceScenarioEventMediaService(
      TraceMediaExtractionService.create({
        store: TraceMediaStoreService.create({ storedObjects, purpose: SCENARIO_EVENT_MEDIA }),
      }),
    );
  }

  private constructor(private readonly extraction: TraceMediaExtractionService) {}

  extractInlineMediaFromEvent(input: {
    event: unknown;
    projectId: string;
    ownerKind: "scenario_run";
    ownerId: string;
    purpose: "scenario_event";
  }): Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }> {
    const { event, projectId, ownerId } = input;

    return tracer.withActiveSpan(
      "StoredObjects.extractInlineMediaFromEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_objects.purpose": SCENARIO_EVENT_MEDIA.purpose,
          "stored_objects.owner_kind": SCENARIO_EVENT_MEDIA.ownerKind,
          // Customer-controlled but low-entropy, and the tenant id rides on the same span.
          "stored_objects.owner_id": ownerId,
        },
      },
      async (span) => {
        const result = await this.rewriteEvent(event, { projectId, ownerId });
        span.setAttribute("stored_objects.refs_extracted", result.refs.length);

        return result;
      },
    );
  }

  /** Shape A carries one `message`, shape B a `messages` array; anything else passes through. */
  private async rewriteEvent(
    event: unknown,
    params: EventParams,
  ): Promise<{ rewrittenEvent: unknown; refs: ExtractedRef[] }> {
    if (typeof event !== "object" || event === null) return { rewrittenEvent: event, refs: [] };
    const eventObj = event as Record<string, unknown>;
    const single = eventObj.message;
    if (single && typeof single === "object" && !Array.isArray(single)) {
      const { message, refs } = await this.rewriteMessage(
        single as Record<string, unknown>,
        params,
      );

      return { rewrittenEvent: message === single ? event : { ...eventObj, message }, refs };
    }

    if (!Array.isArray(eventObj.messages)) return { rewrittenEvent: event, refs: [] };
    const messages: unknown[] = [];
    const refs: ExtractedRef[] = [];
    let changed = false;
    for (const m of eventObj.messages) {
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        messages.push(m);
        continue;
      }

      const rewritten = await this.rewriteMessage(m as Record<string, unknown>, params);
      changed ||= rewritten.message !== m;
      messages.push(rewritten.message);
      refs.push(...rewritten.refs);
    }

    return { rewrittenEvent: changed ? { ...eventObj, messages } : event, refs };
  }

  /** The same message back when nothing moved; a store failure propagates. */
  private async rewriteMessage(
    message: Record<string, unknown>,
    { projectId, ownerId }: EventParams,
  ): Promise<{ message: Record<string, unknown>; refs: ExtractedRef[] }> {
    const content = coerceContentToArray(message.content);
    if (content === null) return { message, refs: [] };
    const refs: ExtractedRef[] = [];
    const parts: unknown[] = [];
    let changed = false;
    for (const raw of content) {
      const { part, ref } = await this.extraction.extractFromPart({
        part: raw,
        projectId,
        ownerId,
      });
      changed ||= part !== raw;
      parts.push(part);
      if (ref) refs.push(ref);
    }

    return { message: changed ? { ...message, content: parts } : message, refs };
  }
}
