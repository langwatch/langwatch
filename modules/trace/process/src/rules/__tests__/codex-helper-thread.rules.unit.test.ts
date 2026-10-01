import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  codexHelperThreadMarkersOf,
  stampCodexHelperThread,
} from "../codex-helper-thread.rules.ts";

const THREAD_ID = "0195a0b1-1111-7222-8333-444455556666";
const REQUEST_SPAN_ID = "aaaaaaaaaaaaaaaa";

function span({
  name,
  spanId,
  parentSpanId = null,
  attributes = {},
}: {
  name: string;
  spanId: string;
  parentSpanId?: string | null;
  attributes?: Record<string, string>;
}): OtlpSpan {
  return {
    traceId: "t".repeat(32),
    spanId,
    traceState: null,
    parentSpanId,
    name,
    kind: 1,
    startTimeUnixNano: "1000000",
    endTimeUnixNano: "2000000",
    attributes: Object.entries(attributes).map(([key, stringValue]) => ({
      key,
      value: { stringValue },
    })),
    events: [],
    links: [],
    status: { code: 0 },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

const requestSpan = span({
  name: "turn/start",
  spanId: REQUEST_SPAN_ID,
  attributes: { "rpc.request_id": "temporary-structured-turn-1234" },
});
const queueChild = span({
  name: "app_server.serialized_request_queue",
  spanId: "bbbbbbbbbbbbbbbb",
  parentSpanId: REQUEST_SPAN_ID,
  attributes: { key: `Thread { thread_id: "${THREAD_ID}" }` },
});

describe("codexHelperThreadMarkersOf", () => {
  describe("when a temporary structured request span and its queue child share a batch", () => {
    /** @scenario "A codex temporary structured request names its helper thread" */
    it("maps the request span to the thread its child names", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [{ scopeName: "codex_cli_rs", spans: [requestSpan, queueChild] }],
      });

      expect(markers.get(REQUEST_SPAN_ID)).toBe(THREAD_ID);
    });
  });

  describe("when the queue child is not in the batch", () => {
    /** @scenario "A codex temporary structured request names its helper thread" */
    it("maps the request span to nothing", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [{ scopeName: "codex_cli_rs", spans: [requestSpan] }],
      });

      expect(markers.size).toBe(0);
    });
  });

  describe("when the request span and its child sit under different scope entries", () => {
    /** @scenario "A codex helper request and its queue child split across scope entries still join" */
    it("still maps the request span to the thread id the child names", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [
          { scopeName: "codex_cli_rs", spans: [requestSpan] },
          { scopeName: "codex-app-server", spans: [queueChild] },
        ],
      });

      expect(markers.get(REQUEST_SPAN_ID)).toBe(THREAD_ID);
    });

    /** @scenario "A codex helper request and its queue child split across scope entries still join" */
    it("maps a request span under a scope that is not codex to nothing", () => {
      const markers = codexHelperThreadMarkersOf({
        scopes: [
          { scopeName: "some.other.tool", spans: [requestSpan] },
          { scopeName: "codex-app-server", spans: [queueChild] },
        ],
      });

      expect(markers.size).toBe(0);
    });
  });
});

describe("stampCodexHelperThread", () => {
  it("adds the helper's thread id under langwatch.thread.id", () => {
    const stamped = stampCodexHelperThread({ span: requestSpan, threadId: THREAD_ID });

    expect(stamped.attributes).toContainEqual({
      key: "langwatch.thread.id",
      value: { stringValue: THREAD_ID },
    });
  });
});
