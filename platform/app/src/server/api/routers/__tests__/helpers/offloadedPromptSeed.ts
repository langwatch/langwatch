/**
 * The offloaded-prompt rows the playground trace-link suites share: an llm
 * span holding only a preview under an eventref pointer, and the event_log row
 * holding the full content the pointer names.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { insertEventLogRow } from "~/server/app-layer/traces/__tests__/blob-offload-test-helpers";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { spanRow } from "./aggregateTraceRoutes";

const messages = (userTurn: string) =>
  JSON.stringify([
    { role: "system", content: "You are a careful assistant." },
    { role: "user", content: userTurn },
  ]);

export const FULL_TURN = `Summarise this: ${"x".repeat(70_000)}`;
export const PREVIEW_TURN = "Summarise this: xxx…";

/** An llm span holding only the preview, under a pointer into event_log. */
export function offloadedLlmRow({
  tenantId,
  traceId,
  occurredAt,
  eventId,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
  eventId: string;
}) {
  return {
    ...spanRow({ tenantId, traceId, occurredAt }),
    SpanAttributes: {
      "langwatch.span.type": "llm",
      "langwatch.input": messages(PREVIEW_TURN),
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId,
      }),
    },
  };
}

/** The full content `offloadedLlmRow` points at, under one project only. */
export async function seedOffloadedInput({
  ch,
  tenantId,
  traceId,
  eventId,
}: {
  ch: ClickHouseClient;
  tenantId: string;
  traceId: string;
  eventId: string;
}): Promise<void> {
  await insertEventLogRow({
    client: ch,
    tenantId,
    aggregateId: traceId,
    eventId,
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    eventData: {
      span: {
        attributes: [
          {
            key: "langwatch.input",
            value: { stringValue: messages(FULL_TURN) },
          },
        ],
      },
    },
  });
}
