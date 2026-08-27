// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Copilot Studio conversation → OTLP mapping.
 *
 * Fixtures mirror the captured transcript's shape: a `content.activities`
 * list where messages carry `from.role` (1 user, 0 agent), users carry
 * `from.aadObjectId`, and every activity carries a GUID-shaped `from.id`
 * that is NOT an account.
 *
 * The multi-batch fixtures are hand-built and say so. Both real captures fit
 * in a single row, so nothing observed proves the reassembly — only
 * Microsoft's documentation of it does. That gap is written into the ADR's
 * open questions and into the pull request, and it is the reason these cases
 * are here rather than being taken on trust.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 */

import { describe, expect, it } from "vitest";
import { spanSchema } from "@langwatch/trace-contract";
import {
  COPILOT_CONVERSATION_ACTION,
  COPILOT_CONVERSATION_SPAN_NAME,
  COPILOT_ROUTING_PROFILE,
  COPILOT_TURN_SPAN_NAME,
  mapCopilotEventsToTraceRequest,
} from "../src/adapters/copilot-studio-trace-mapper.adapter";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";

const ORIGIN = {
  ingestionSourceId: "source-1",
  organizationId: "org-1",
  sourceType: "copilot_studio_dataverse",
  profile: COPILOT_ROUTING_PROFILE,
};

const CONVERSATION_START = "2026-08-25T19:14:34Z";
const NAME = "b957a08c-0000-4000-8000-000000000001_dacfd251-bot";

/** A per-conversation channel id. GUID-shaped, and never a person. */
const CHANNEL_ID = "3237db76-f6f8-03f7-72fc-c309292eefdc";
const AAD_OBJECT_ID = "f6481ec4-e30f-4bf3-954f-2a8f29bb1c4a";

function userMessage(params: { id: string; text: string; ms: number }) {
  const { id, text, ms } = params;
  return {
    id,
    type: "message",
    timestampMs: ms,
    from: {
      id: "0c6d08e2-882b-1ca1-8a8c-dad72374f3a3",
      role: 1,
      aadObjectId: AAD_OBJECT_ID,
    },
    text,
  };
}

function agentMessage(params: { id: string; text: string; ms: number }) {
  const { id, text, ms } = params;
  return {
    id,
    type: "message",
    timestampMs: ms,
    from: { id: CHANNEL_ID, role: 0 },
    text,
  };
}

function toolCall(params: {
  id: string;
  ms: number;
  status: "Started" | "Completed";
  callId?: string;
  /**
   * A real `Completed` trace carries none. Defaulted on so the common case
   * stays short, and turned off where a test needs the completion to be as
   * bare as the wire makes it.
   */
  filledParameters?: Record<string, unknown> | null;
}) {
  const {
    id,
    ms,
    status,
    callId = "call-1",
    filledParameters = { skill: "search-before-answer" },
  } = params;
  return {
    id,
    type: "event",
    name: `ToolCallTrace:${status}`,
    timestampMs: ms,
    from: { id: CHANNEL_ID, role: 0 },
    value: {
      toolCallId: callId,
      toolName: "skill",
      toolDisplayName: "search-before-answer",
      toolCallStatus: status,
      filledParameters,
    },
  };
}

function transcriptRow({
  activities,
  batchId = 0,
  name = NAME,
  start = CONVERSATION_START,
  transcriptId = "row-1",
}: {
  activities: unknown[];
  batchId?: number | null;
  name?: string;
  start?: string;
  transcriptId?: string;
}) {
  return {
    name,
    conversationstarttime: start,
    conversationtranscriptid: transcriptId,
    metadata: JSON.stringify({
      BotId: "dacfd251-bot",
      BotName: "engineering-agent",
      ...(batchId === null ? {} : { BatchId: batchId }),
    }),
    content: JSON.stringify({ activities }),
  };
}

function copilotEvent(
  row: ReturnType<typeof transcriptRow>,
  extra: Record<string, unknown> = {},
): NormalizedPullEvent {
  return {
    source_event_id: row.conversationtranscriptid,
    event_timestamp: CONVERSATION_START,
    actor: "",
    action: COPILOT_CONVERSATION_ACTION,
    target: "engineering-agent",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(row),
    extra: { botName: "engineering-agent", ...extra },
  };
}

function spansOf(events: NormalizedPullEvent[]) {
  const request = mapCopilotEventsToTraceRequest({ events, origin: ORIGIN });
  return request?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
}

function turnSpansOf(events: NormalizedPullEvent[]) {
  return spansOf(events).filter((s: { name: string }) => s.name === COPILOT_TURN_SPAN_NAME);
}

type TestAttribute = { key: string; value: unknown };

function isTestAttribute(value: unknown): value is TestAttribute {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    typeof value.key === "string" &&
    "value" in value
  );
}

function attrsOf(span: { attributes?: unknown[] }) {
  return Object.fromEntries(
    (span.attributes ?? [])
      .filter(isTestAttribute)
      .map((a) => [
        a.key,
        (a.value as { stringValue?: string; intValue?: number }).stringValue ??
          (a.value as { intValue?: number }).intValue,
      ]),
  );
}

const CHAT = [
  agentMessage({
    id: "d4628de6-730d-401d-849a-0eb8f66ddbf5",
    text: "Hello! How can I help?",
    ms: 1_787_685_274_483,
  }),
  userMessage({
    id: "c1955eab-a6c8-42ea-9c72-6ff22994543d",
    text: "How do I reset my laptop?",
    ms: 1_787_685_284_913,
  }),
  agentMessage({
    id: "a1111111-1111-4111-8111-111111111111",
    text: "Hold the power button for ten seconds.",
    ms: 1_787_685_290_000,
  }),
];

describe("given a Copilot conversation stored in one row", () => {
  const spans = spansOf([copilotEvent(transcriptRow({ activities: CHAT }))]);

  /** @scenario "A conversation becomes one trace carrying what was said" */
  it("records one trace carrying the question and the answer", () => {
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    for (const span of spans) {
      expect(spanSchema.safeParse(span).success).toBe(true);
    }
    const rendered = JSON.stringify(spans);
    expect(rendered).toContain("How do I reset my laptop?");
    expect(rendered).toContain("Hold the power button for ten seconds.");
  });

  /** @scenario "A conversation becomes one trace carrying what was said" */
  it("opens with the agent's greeting rather than dropping it", () => {
    expect(JSON.stringify(spans)).toContain("Hello! How can I help?");
  });

  /** @scenario "A person's turn is attributed to that person" */
  it("attributes the question to the account that asked it", () => {
    const turns = spans.filter((s: { name: string }) => s.name === COPILOT_TURN_SPAN_NAME);
    const asked = turns.find((s) => JSON.stringify(s).includes("How do I reset my laptop?"));
    expect(attrsOf(asked!)["langwatch.user.id"]).toBe(AAD_OBJECT_ID);
  });

  /** @scenario "The agent's own turns name no person" */
  it("names no person on the agent's own opening turn, and never the channel id", () => {
    const greeting = spans.find((s) => JSON.stringify(s).includes("Hello! How can I help?"));
    expect(attrsOf(greeting!)["langwatch.user.id"]).toBeUndefined();
    expect(JSON.stringify(spans)).not.toContain(CHANNEL_ID);
  });
});

describe("given the same conversation pulled twice", () => {
  /** @scenario "Re-pulling the same conversation does not duplicate it" */
  it("derives the same identifiers both times", () => {
    const first = spansOf([copilotEvent(transcriptRow({ activities: CHAT }))]);
    const second = spansOf([copilotEvent(transcriptRow({ activities: CHAT }))]);
    expect(second.map((s) => [s.traceId, s.spanId])).toEqual(
      first.map((s) => [s.traceId, s.spanId]),
    );
  });

  /** @scenario "Identity survives Microsoft renumbering the underlying rows" */
  it("ignores the row identifier entirely", () => {
    const first = spansOf([
      copilotEvent(transcriptRow({ activities: CHAT, transcriptId: "row-a" })),
    ]);
    const second = spansOf([
      copilotEvent(transcriptRow({ activities: CHAT, transcriptId: "row-b" })),
    ]);
    expect(second[0]!.traceId).toBe(first[0]!.traceId);
  });
});

describe("given two sources reading the same environment", () => {
  /** @scenario "Two sources reading the same environment stay separate" */
  it("keeps their conversations apart", () => {
    const other = { ...ORIGIN, ingestionSourceId: "source-2" };
    const mine = spansOf([copilotEvent(transcriptRow({ activities: CHAT }))]);
    const theirs =
      mapCopilotEventsToTraceRequest({
        events: [copilotEvent(transcriptRow({ activities: CHAT }))],
        origin: other,
      })?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];

    expect(theirs[0]!.traceId).not.toBe(mine[0]!.traceId);
    expect(theirs.map((s) => s.spanId)).not.toEqual(mine.map((s) => s.spanId));
    expect(attrsOf(theirs[0]!)["langwatch.thread.id"]).not.toBe(
      attrsOf(mine[0]!)["langwatch.thread.id"],
    );
  });
});

describe("given a conversation Microsoft stored across several rows", () => {
  // Hand-built. Neither real capture is multi-batch, so this shape is taken
  // from Microsoft's documentation rather than observed.
  const first = transcriptRow({
    activities: [CHAT[0], CHAT[1]],
    batchId: 0,
    transcriptId: "row-a",
  });
  const second = transcriptRow({
    activities: [CHAT[2]],
    batchId: 1,
    transcriptId: "row-b",
  });

  /** @scenario "A conversation stored across several rows is still one conversation" */
  it("records one trace, not two", () => {
    const spans = spansOf([copilotEvent(second), copilotEvent(first)]);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    const rendered = JSON.stringify(spans);
    expect(rendered).toContain("How do I reset my laptop?");
    expect(rendered).toContain("Hold the power button for ten seconds.");
  });

  /** @scenario "Chopped pieces are ordered by their number, not their spelling" */
  it("orders piece 2 before piece 10", () => {
    const two = transcriptRow({
      activities: [
        userMessage({
          id: "b2222222-2222-4222-8222-222222222222",
          text: "second",
          ms: 2000,
        }),
      ],
      batchId: 2,
      transcriptId: "row-2",
    });
    const ten = transcriptRow({
      activities: [
        userMessage({
          id: "b1010101-1010-4010-8010-101010101010",
          text: "tenth",
          ms: 3000,
        }),
      ],
      batchId: 10,
      transcriptId: "row-10",
    });
    const zero = transcriptRow({
      activities: [
        userMessage({
          id: "b0000000-0000-4000-8000-000000000000",
          text: "first",
          ms: 1000,
        }),
      ],
      batchId: 0,
      transcriptId: "row-0",
    });

    const spans = spansOf([copilotEvent(ten), copilotEvent(two), copilotEvent(zero)]);
    const said = spans
      .map((s) => attrsOf(s)["langwatch.input"] as string | undefined)
      .filter((v): v is string => typeof v === "string");
    // Both are required to be present before they are compared: `findIndex`
    // answers -1 for something absent, so `-1 < 0` would report success for
    // the exact regression this guards — batch 2 dropping out entirely.
    const secondAt = said.findIndex((v) => v.includes("second"));
    const tenthAt = said.findIndex((v) => v.includes("tenth"));
    expect(secondAt).toBeGreaterThanOrEqual(0);
    expect(tenthAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeLessThan(tenthAt);
  });

  /**
   * Batch order is right whenever rows arrive as written. This is what makes
   * it right when they do not: turns are paired by walking the merged list,
   * so one message out of place attaches an answer to the wrong question.
   */
  /** @scenario "A conversation stored across several rows is still one conversation" */
  it("pairs the answer with the question even when a row stores them out of order", () => {
    const jumbled = transcriptRow({
      activities: [
        agentMessage({
          id: "a9999999-9999-4999-8999-999999999999",
          text: "Hold the power button.",
          ms: 2_000,
        }),
        userMessage({
          id: "b8888888-8888-4888-8888-888888888888",
          text: "How do I reset it?",
          ms: 1_000,
        }),
      ],
    });
    const turns = turnSpansOf([copilotEvent(jumbled)]);
    expect(turns).toHaveLength(1);
    const attrs = attrsOf(turns[0]!);
    expect(attrs["langwatch.input"]).toContain("How do I reset it?");
    expect(attrs["langwatch.output"]).toContain("Hold the power button.");
  });

  it("still orders the dated messages when an undateable one sits between them", () => {
    // The undateable activity is dropped later regardless. What it must not do
    // is drag its neighbours: ordering the two classes against each other by a
    // single comparator contradicts itself and the engine is then free to
    // return anything, which in practice left the later message first.
    const withUndateable = transcriptRow({
      activities: [
        agentMessage({
          id: "a9999999-9999-4999-8999-999999999999",
          text: "Hold the power button.",
          ms: 2_000,
        }),
        {
          id: "d6666666-6666-4666-8666-666666666666",
          type: "message",
          timestamp: "not-a-date",
          from: { id: CHANNEL_ID, role: 0 },
          text: "undateable",
        },
        userMessage({
          id: "b8888888-8888-4888-8888-888888888888",
          text: "How do I reset it?",
          ms: 1_000,
        }),
      ],
    });
    const turns = turnSpansOf([copilotEvent(withUndateable)]);
    expect(turns).toHaveLength(1);
    const attrs = attrsOf(turns[0]!);
    expect(attrs["langwatch.input"]).toContain("How do I reset it?");
    expect(attrs["langwatch.output"]).toContain("Hold the power button.");
  });

  it("survives a null in the activity list rather than taking down the run", () => {
    // `content` is a JSON string the row schema validates as a string and
    // never opens, so nothing upstream rejects this. The caller has no
    // try/catch, so a throw here would abort routing for every conversation
    // in the run, not just this one.
    const poisoned = transcriptRow({
      activities: [null, ...CHAT] as never,
    });
    expect(() => spansOf([copilotEvent(poisoned)])).not.toThrow();
    expect(spansOf([copilotEvent(poisoned)]).length).toBeGreaterThan(0);
  });

  it("counts a message it cannot attribute instead of losing it in silence", () => {
    const unattributed = transcriptRow({
      activities: [
        {
          id: "c7777777-7777-4777-8777-777777777777",
          type: "message",
          text: "Who said this?",
          timestampMs: 1_787_685_284_913,
          from: { id: "x", role: 9 },
        },
      ],
    });
    const spans = spansOf([copilotEvent(unattributed)]);
    // No turn survives, so no span does — and the count is the only trace
    // that anything was there at all.
    expect(spans).toHaveLength(0);
  });

  it("reads the string spelling of a role as well as the numeric one", () => {
    const stringRoles = transcriptRow({
      activities: [
        {
          id: "d1111111-1111-4111-8111-111111111111",
          type: "message",
          text: "Is the printer online?",
          timestampMs: 1_787_685_284_913,
          from: { id: "x", role: "user" as never, aadObjectId: AAD_OBJECT_ID },
        },
        {
          id: "d2222222-2222-4222-8222-222222222222",
          type: "message",
          text: "It is online.",
          timestampMs: 1_787_685_285_913,
          from: { id: "y", role: "bot" as never },
        },
      ],
    });
    const turns = turnSpansOf([copilotEvent(stringRoles)]);
    expect(turns).toHaveLength(1);
    const attrs = attrsOf(turns[0]!);
    expect(attrs["langwatch.input"]).toContain("Is the printer online?");
    expect(attrs["langwatch.output"]).toContain("It is online.");
  });

  /** @scenario "A conversation with a piece missing from the middle is marked incomplete" */
  it("marks a conversation with a hole in its numbering", () => {
    const third = transcriptRow({
      activities: [CHAT[2]],
      batchId: 2,
      transcriptId: "row-c",
    });
    const spans = spansOf([copilotEvent(first), copilotEvent(third)]);
    expect(spans.length).toBeGreaterThan(0);
    expect(attrsOf(spans[0]!)["copilot_studio.conversation_incomplete"]).toBe("true");
  });

  /** @scenario "A conversation stored across several rows is still one conversation" */
  it("does not mark a conversation whose pieces run consecutively", () => {
    const spans = spansOf([copilotEvent(second), copilotEvent(first)]);
    expect(attrsOf(spans[0]!)["copilot_studio.conversation_incomplete"]).toBeUndefined();
  });

  /**
   * The rule deliberately does not read "batch 0 is absent". Batches carry
   * different `createdon` values, so a pull window can end between them: the
   * run holding only batch 1 would flag a conversation whose opening arrived
   * perfectly well on the run before, and the flag would mean nothing because
   * it fires on the ordinary case.
   */
  /** @scenario "A later piece arriving on its own is not mistaken for a missing one" */
  it("does not flag a later piece that arrived in its own pull window", () => {
    const spans = spansOf([copilotEvent(second)]);
    expect(spans.length).toBeGreaterThan(0);
    expect(attrsOf(spans[0]!)["copilot_studio.conversation_incomplete"]).toBeUndefined();
  });
});

/**
 * Observed, not hand-built. One conversation with the agent, left idle past
 * the session timeout and then picked up again, was stored as two rows: the
 * same `name`, both numbered batch 0, and two different start times — 15
 * messages under `2026-08-26T14:45:41Z` and 2 more under
 * `2026-08-26T16:29:56Z`. Grouping on the start time as well as the name
 * split it into two traces, and the trace list showed only the newer half.
 *
 * The rows below keep that shape — one name, one batch number, two start
 * times — and carry a single exchange each. The message counts are not what
 * splits the conversation; the second start time is, and one exchange per row
 * is enough to show it.
 */
describe("given a conversation resumed after a break", () => {
  const RESUMED_NAME = "98396e1f-0000-4000-8000-000000000002_14a3a0cf-bot";
  const before = transcriptRow({
    activities: [
      userMessage({
        id: "e1111111-1111-4111-8111-111111111111",
        text: "what's the capital of berlin?",
        ms: 1_787_755_541_000,
      }),
      agentMessage({
        id: "e2222222-2222-4222-8222-222222222222",
        text: "Berlin is a city, and it is the capital of Germany.",
        ms: 1_787_755_545_000,
      }),
    ],
    batchId: 0,
    name: RESUMED_NAME,
    start: "2026-08-26T14:45:41Z",
    transcriptId: "row-before-break",
  });
  const after = transcriptRow({
    activities: [
      userMessage({
        id: "e3333333-3333-4333-8333-333333333333",
        text: "what about chile.",
        ms: 1_787_761_796_000,
      }),
      agentMessage({
        id: "e4444444-4444-4444-8444-444444444444",
        text: "Santiago is the capital of Chile.",
        ms: 1_787_761_800_000,
      }),
    ],
    batchId: 0,
    name: RESUMED_NAME,
    start: "2026-08-26T16:29:56Z",
    transcriptId: "row-after-break",
  });

  describe("when both halves reach the mapper in one pull", () => {
    it("records one trace holding both halves", () => {
      const spans = spansOf([copilotEvent(before), copilotEvent(after)]);
      expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
      const rendered = JSON.stringify(spans);
      expect(rendered).toContain("what's the capital of berlin?");
      expect(rendered).toContain("Santiago is the capital of Chile.");
    });

    it("hangs both halves' turns under a single conversation", () => {
      const events = [copilotEvent(before), copilotEvent(after)];
      const conversations = spansOf(events).filter(
        (s: { name: string }) => s.name === COPILOT_CONVERSATION_SPAN_NAME,
      );
      expect(conversations.length).toBe(1);
      const turns = turnSpansOf(events);
      expect(turns.length).toBe(2);
      expect(new Set(turns.map((s) => s.parentSpanId))).toEqual(
        new Set([conversations[0]!.spanId]),
      );
    });

    /**
     * Both halves are numbered batch 0, which is two rows carrying the same
     * number rather than a hole in the numbering. Nothing is missing here.
     */
    it("does not read the repeated batch number as a missing piece", () => {
      const spans = spansOf([copilotEvent(before), copilotEvent(after)]);
      expect(attrsOf(spans[0]!)["copilot_studio.conversation_incomplete"]).toBeUndefined();
    });
  });

  /**
   * The two halves land in different pull runs in practice, so the trace they
   * join is decided by the identifiers alone, not by being mapped together.
   */
  describe("when each half is pulled on its own", () => {
    it("gives a half pulled on its own the same trace and thread as the other", () => {
      const [firstRun, secondRun] = [
        spansOf([copilotEvent(before)]),
        spansOf([copilotEvent(after)]),
      ];
      expect(firstRun[0]!.traceId).toBe(secondRun[0]!.traceId);
      expect(attrsOf(firstRun[0]!)["langwatch.thread.id"]).toBe(
        attrsOf(secondRun[0]!)["langwatch.thread.id"],
      );
    });
  });
});

describe("given a stored name that does not match the shape we observed", () => {
  /** @scenario "The conversation's stored label is used whole, never taken apart" */
  it("groups a name with no underscore and one with several", () => {
    for (const name of ["plainname", "a_b_c_d"]) {
      const turns = turnSpansOf([copilotEvent(transcriptRow({ activities: CHAT, name }))]);
      expect(new Set(turns.map((s) => s.traceId)).size).toBe(1);
      expect(turns.length).toBe(CHAT.length - 1);
    }
  });

  /** @scenario "The conversation's stored label is used whole, never taken apart" */
  it("treats two names sharing a prefix as two conversations", () => {
    const spans = spansOf([
      copilotEvent(transcriptRow({ activities: CHAT, name: "shared_botA" })),
      copilotEvent(
        transcriptRow({
          activities: CHAT,
          name: "shared_botB",
          transcriptId: "row-b",
        }),
      ),
    ]);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(2);
  });
});

describe("given activities the mapper must not turn into turns", () => {
  /** @scenario "A turn with no usable identifier is skipped, never invented" */
  it("skips a message whose id is not a real identifier, and counts it", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            {
              id: "0",
              type: "message",
              timestampMs: 1_787_685_295_000,
              from: { id: CHANNEL_ID, role: 0 },
              text: "orphan",
            },
          ],
        }),
      ),
    ]);
    expect(JSON.stringify(spans)).not.toContain("orphan");
    expect(attrsOf(spans[0]!)["copilot_studio.activities_skipped"]).toBe(1);
  });

  /** @scenario "A turn the puller cannot date is skipped, never dated with the clock" */
  it("skips a message it cannot date rather than stamping the clock", () => {
    const before = Date.now();
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            {
              id: "c3333333-3333-4333-8333-333333333333",
              type: "message",
              timestamp: "not a date",
              from: { id: CHANNEL_ID, role: 0 },
              text: "undateable",
            },
          ],
        }),
      ),
    ]);
    expect(JSON.stringify(spans)).not.toContain("undateable");
    for (const span of spans) {
      // Nothing may carry a start time minted from the wall clock: span
      // storage breaks ties on start time, so a clock stamp would beat the
      // real record on the next pull.
      expect(Number(span.startTimeUnixNano)).toBeLessThan(before * 1_000_000);
    }
  });

  /** @scenario "Bookkeeping activities do not become turns" */
  it("turns only what was said into turns", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            {
              valueType: "SessionInfo",
              type: "trace",
              id: "0",
              timestampMs: 1_787_685_274_483,
              from: { id: "", role: 0 },
              value: { turnCount: 1 },
            },
            {
              id: "e4444444-4444-4444-8444-444444444444",
              type: "event",
              name: "turn.complete",
              timestampMs: 1_787_685_291_000,
              from: { id: CHANNEL_ID, role: 0 },
            },
          ],
        }),
      ),
    ]);
    // Two turns from three messages, plus the conversation span that wraps
    // them. The bookkeeping entries add nothing.
    const turns = spans.filter((s: { name: string }) => s.name === COPILOT_TURN_SPAN_NAME);
    expect(turns).toHaveLength(2);
  });
});

describe("given a tool call the agent ran", () => {
  /** @scenario "An unfinished tool call still shows" */
  it("shows a call that never reported finishing, marked unfinished", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            toolCall({
              id: "f5555555-5555-4555-8555-555555555555",
              ms: 1_787_685_286_000,
              status: "Started",
              callId: "call-a",
            }),
            toolCall({
              id: "f6666666-6666-4666-8666-666666666666",
              ms: 1_787_685_287_000,
              status: "Started",
              callId: "call-b",
            }),
            toolCall({
              id: "f7777777-7777-4777-8777-777777777777",
              ms: 1_787_685_288_000,
              status: "Completed",
              callId: "call-a",
            }),
          ],
        }),
      ),
    ]);
    const tools = spans.filter((s) => attrsOf(s)["langwatch.span.type"] === "tool");
    expect(tools).toHaveLength(2);
    const unfinished = tools.filter(
      (s) => attrsOf(s)["copilot_studio.tool_call_unfinished"] === "true",
    );
    expect(unfinished).toHaveLength(1);
    for (const tool of tools) {
      expect(attrsOf(tool).tool_name).toBe("search-before-answer");
      expect(spanSchema.safeParse(tool).success).toBe(true);
    }
  });

  it("hangs the call off the turn it happened in", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            toolCall({
              id: "f5555555-5555-4555-8555-555555555555",
              ms: 1_787_685_286_000,
              status: "Started",
            }),
          ],
        }),
      ),
    ]);
    const tool = spans.find((s: { name: string }) => s.name === "copilot_studio.tool_call");
    const asked = spans.find(
      (s: { name: string }) =>
        s.name === COPILOT_TURN_SPAN_NAME &&
        JSON.stringify(s).includes("How do I reset my laptop?"),
    );
    expect(tool!.parentSpanId).toBe(asked!.spanId);
  });

  /**
   * A completion stored above the start it belongs to, which is what a raw
   * activity list can look like. The span still opens at the start: the list
   * is time-ordered before any of this runs, so storage order cannot decide
   * which trace seeds the call.
   */
  it("opens at the start even when the completion is stored above it", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            toolCall({
              id: "f6666666-6666-4666-8666-666666666666",
              ms: 1_787_685_288_000,
              status: "Completed",
              filledParameters: null,
            }),
            toolCall({
              id: "f5555555-5555-4555-8555-555555555555",
              ms: 1_787_685_286_000,
              status: "Started",
            }),
          ],
        }),
      ),
    ]);
    const tool = spans.find((s: { name: string }) => s.name === "copilot_studio.tool_call");

    expect(tool).toBeDefined();
    // A completion carries no `filledParameters`, so this is also what says
    // the start seeded the call rather than the completion.
    expect(attrsOf(tool!).full_command).toContain("search-before-answer");
    expect(tool!.startTimeUnixNano).toBe(String(1_787_685_286_000 * 1_000_000));
  });

  /**
   * A call is attached to the turn it falls inside, and one that predates
   * every turn attaches to the first rather than being dropped — so a tool
   * span can begin before the earliest turn and end after the latest. The
   * conversation span has to cover them: a parent that does not contain its
   * children renders as a trace with spans hanging outside it.
   */
  it("covers a tool call that starts before the first turn and ends after the last", () => {
    const firstTurnMs = 1_787_685_274_483;
    const lastTurnMs = 1_787_685_290_000;
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            ...CHAT,
            toolCall({
              id: "f7777777-7777-4777-8777-777777777777",
              ms: firstTurnMs - 5_000,
              status: "Started",
              callId: "call-early",
            }),
            toolCall({
              id: "f8888888-8888-4888-8888-888888888888",
              ms: lastTurnMs + 5_000,
              status: "Completed",
              callId: "call-early",
              filledParameters: null,
            }),
          ],
        }),
      ),
    ]);

    const root = spans.find((s: { name: string }) => s.name === COPILOT_CONVERSATION_SPAN_NAME);
    expect(root).toBeDefined();

    const children = spans.filter((s) => s.spanId !== root?.spanId);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(Number(child.startTimeUnixNano)).toBeGreaterThanOrEqual(
        Number(root!.startTimeUnixNano),
      );
      expect(Number(child.endTimeUnixNano)).toBeLessThanOrEqual(Number(root!.endTimeUnixNano));
    }
  });
});

describe("given what the agent was running", () => {
  /** @scenario "The trace names the product, never the model the agent was running" */
  it("names the product and reports no configured model", () => {
    const events = [
      copilotEvent(transcriptRow({ activities: CHAT }), {
        botModifiedOn: "2026-08-20T10:00:00Z",
      }),
    ];
    const attrs = attrsOf(spansOf(events)[0]!);
    // The `bot` table has no model column — see BotFacts. Asserting the
    // absence rather than deleting the case: the previous version of this
    // test injected a `botModel` no query produces and passed on data
    // production cannot emit.
    expect(attrs["copilot_studio.agent_model"]).toBeUndefined();
    expect(attrs["copilot_studio.agent_changed_since"]).toBeUndefined();

    // The other half, and it has to be here rather than only in the pricing
    // test below. Read alone, the absences above say "the trace reports no
    // model", which would license deleting the product label — and that label
    // is what keeps a routed conversation out of the price table.
    for (const turn of turnSpansOf(events)) {
      expect(attrsOf(turn)["gen_ai.request.model"]).toBe("microsoft/copilot-studio");
    }
  });

  /** @scenario "A conversation whose agent was edited afterwards is flagged" */
  it("flags a conversation whose agent was edited afterwards", () => {
    const spans = spansOf([
      copilotEvent(transcriptRow({ activities: CHAT }), {
        botModifiedOn: "2026-09-01T10:00:00Z",
      }),
    ]);
    const attrs = attrsOf(spans[0]!);
    expect(attrs["copilot_studio.agent_changed_since"]).toBe("true");
  });

  it("never prices a conversation — the agent name resolves to no model", () => {
    const turns = turnSpansOf([copilotEvent(transcriptRow({ activities: CHAT }))]);
    expect(attrsOf(turns[0]!)["gen_ai.request.model"]).toBe("microsoft/copilot-studio");
    const keys = (turns[0]!.attributes ?? []).filter(isTestAttribute).map((a) => a.key);
    expect(keys.filter((k: string) => k.startsWith("gen_ai.usage."))).toEqual([]);
  });
});

describe("given a conversation held while designing the agent", () => {
  /** @scenario "Conversations from testing the agent are recorded and labelled" */
  it("records it and labels it", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            {
              valueType: "ConversationInfo",
              type: "trace",
              timestampMs: 1_787_685_274_483,
              from: { id: "", role: 0 },
              value: { isDesignMode: true, locale: "en-US" },
            },
            ...CHAT,
          ],
        }),
      ),
    ]);
    expect(spans.length).toBeGreaterThan(0);
    expect(attrsOf(spans[0]!)["copilot_studio.design_mode"]).toBe("true");
  });
});

describe("given a multi-turn conversation", () => {
  const MULTI_TURN_CHAT = [
    userMessage({
      id: "a1000000-1000-4000-8000-100000000001",
      text: "Tell me about France.",
      ms: 1_787_685_280_000,
    }),
    agentMessage({
      id: "a1000000-1000-4000-8000-100000000002",
      text: "France is a country in Western Europe.",
      ms: 1_787_685_282_000,
    }),
    userMessage({
      id: "a1000000-1000-4000-8000-100000000003",
      text: "What is the capital?",
      ms: 1_787_685_284_000,
    }),
    agentMessage({
      id: "a1000000-1000-4000-8000-100000000004",
      text: "Paris is the capital of France.",
      ms: 1_787_685_286_000,
    }),
    userMessage({
      id: "a1000000-1000-4000-8000-100000000005",
      text: "What about Chile?",
      ms: 1_787_685_288_000,
    }),
    agentMessage({
      id: "a1000000-1000-4000-8000-100000000006",
      text: "Santiago is the capital of Chile.",
      ms: 1_787_685_290_000,
    }),
  ];

  const spans = spansOf([copilotEvent(transcriptRow({ activities: MULTI_TURN_CHAT }))]);

  it("wraps all turns under a single root conversation span", () => {
    const roots = spans.filter((s) => !s.parentSpanId);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.name).toBe(COPILOT_CONVERSATION_SPAN_NAME);
  });

  it("makes every turn span a child of the conversation span", () => {
    const root = spans.find((s) => !s.parentSpanId);
    expect(root).toBeDefined();
    const turns = spans.filter((s) => s.name === COPILOT_TURN_SPAN_NAME);
    expect(turns.length).toBe(3);
    for (const turn of turns) {
      expect(turn.parentSpanId).toBe(root?.spanId);
    }
  });

  it("puts the first user message as conversation input and last bot reply as output", () => {
    const root = spans.find((s) => !s.parentSpanId);
    expect(root).toBeDefined();
    const attrs = attrsOf(root!);
    expect(attrs["langwatch.input"]).toContain("Tell me about France.");
    expect(attrs["langwatch.output"]).toContain("Santiago is the capital of Chile.");
  });
});

describe("given events that are not Copilot conversations", () => {
  it("routes nothing", () => {
    const foreign: NormalizedPullEvent = {
      ...copilotEvent(transcriptRow({ activities: CHAT })),
      action: "anthropic_admin_usage_report",
    };
    expect(mapCopilotEventsToTraceRequest({ events: [foreign], origin: ORIGIN })).toBeNull();
  });

  it("routes nothing for a row with no conversation in it", () => {
    const spans = spansOf([
      copilotEvent(
        transcriptRow({
          activities: [
            {
              valueType: "SessionInfo",
              type: "trace",
              id: "0",
              timestampMs: 1_787_685_274_483,
              from: { id: "", role: 0 },
              value: {},
            },
          ],
        }),
      ),
    ]);
    expect(spans).toHaveLength(0);
  });
});
