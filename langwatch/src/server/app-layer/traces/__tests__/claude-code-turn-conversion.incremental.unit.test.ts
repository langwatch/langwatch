/**
 * Equivalence + convergence tests for the INCREMENTAL Claude Code turn -> span
 * converter.
 *
 * THE EQUIVALENCE PROPERTY (asserted below over several representative turns):
 *
 *   whole-turn single-pass conversion
 *     ===
 *   incremental conversion over MANY random batch partitions
 *     ===
 *   incremental conversion with the state serialized + deserialized between
 *   every batch
 *
 * where `===` is deep equality of the FINAL span set after normalizing the
 * per-emission StartTime nudge, with the LAST emission per span id winning (the
 * stored_spans ReplacingMergeTree upsert). This is the correctness contract:
 * however the records are partitioned into batches, and whether or not the state
 * survives a Redis round-trip between batches, the converged span tree is the
 * same one the whole-turn function produces in a single pass.
 */

import { describe, expect, it } from "vitest";

import {
  type ClaudeCodeLogRecordInput,
  type SynthesizedClaudeSpan,
  convertClaudeCodeTurnToSpans,
  convertClaudeCodeTurnToSpansIncremental,
} from "../claude-code-log-to-span";
import {
  type ClaudeTurnConversionState,
  deserializeClaudeTurnConversionState,
  emptyClaudeTurnConversionState,
  serializeClaudeTurnConversionState,
} from "../claude-code-turn-conversion.state";

const TRACE = "a3c6656cf433e97549f654034be02955";

// ---------------------------------------------------------------------------
// Fixtures: representative turns as ordered ClaudeCodeLogRecordInput[].
// ---------------------------------------------------------------------------

const rec = (
  over: Partial<ClaudeCodeLogRecordInput> & {
    eventName: string;
    attrs: Record<string, string>;
    timeUnixMs: number;
  },
): ClaudeCodeLogRecordInput => ({
  traceId: TRACE,
  spanId: over.spanId ?? "0000000000000000",
  resource: over.resource ?? { attributes: [] },
  instrumentationScope:
    over.instrumentationScope ?? { name: "com.anthropic.claude_code.events", version: "2.1.62" },
  ...over,
});

const requestBody = (text: string) =>
  JSON.stringify({
    model: "claude-opus-4-8",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  });

const responseBody = (text: string) =>
  JSON.stringify({ content: [{ type: "text", text }] });

const requestBodyWithToolResult = (toolUseId: string, result: string) =>
  JSON.stringify({
    model: "claude-opus-4-8",
    messages: [
      { role: "user", content: [{ type: "text", text: "run it" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            tool_use_id: toolUseId,
            type: "tool_result",
            content: result,
            is_error: false,
          },
        ],
      },
    ],
  });

/** A single tool-using turn: prompt, request body, tool_result, anchor,
 * response, and a NEXT request body that feeds the tool result back. */
const simpleToolTurn = (): ClaudeCodeLogRecordInput[] => [
  rec({
    eventName: "user_prompt",
    spanId: "aa00000000000001",
    timeUnixMs: 100,
    attrs: {
      "event.name": "user_prompt",
      "event.sequence": "1",
      "session.id": "s",
      "prompt.id": "p",
      prompt: "List /tmp",
      prompt_length: "9",
    },
  }),
  rec({
    eventName: "api_request_body",
    spanId: "aa00000000000002",
    timeUnixMs: 200,
    attrs: {
      "event.name": "api_request_body",
      "event.sequence": "2",
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: requestBody("List /tmp"),
    },
  }),
  rec({
    eventName: "tool_result",
    spanId: "aa00000000000003",
    timeUnixMs: 1_000,
    attrs: {
      "event.name": "tool_result",
      "event.sequence": "3",
      "session.id": "s",
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      success: "true",
      duration_ms: "50",
      tool_input: '{"command":"ls /tmp"}',
    },
  }),
  rec({
    eventName: "api_request",
    spanId: "aa00000000000004",
    timeUnixMs: 1_200,
    attrs: {
      "event.name": "api_request",
      "event.sequence": "4",
      "session.id": "s",
      model: "claude-opus-4-8",
      input_tokens: "100",
      output_tokens: "20",
      cache_read_tokens: "10",
      cache_creation_tokens: "5",
      cost_usd: "0.05",
      duration_ms: "800",
      request_id: "req_1",
      query_source: "repl_main_thread",
    },
  }),
  rec({
    eventName: "api_response_body",
    spanId: "aa00000000000005",
    timeUnixMs: 1_205,
    attrs: {
      "event.name": "api_response_body",
      "event.sequence": "5",
      "session.id": "s",
      model: "claude-opus-4-8",
      request_id: "req_1",
      query_source: "repl_main_thread",
      body: responseBody("There are 3 files."),
    },
  }),
  rec({
    eventName: "api_request_body",
    spanId: "aa00000000000006",
    timeUnixMs: 2_000,
    attrs: {
      "event.name": "api_request_body",
      "event.sequence": "6",
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: requestBodyWithToolResult("toolu_1", "a.txt\nb.txt\nc.txt"),
    },
  }),
];

/** A two-call turn with no tools, exercising the model input/output joins. */
const twoModelCallTurn = (): ClaudeCodeLogRecordInput[] => [
  rec({
    eventName: "user_prompt",
    spanId: "bb00000000000001",
    timeUnixMs: 100,
    attrs: {
      "event.name": "user_prompt",
      "event.sequence": "1",
      "session.id": "s2",
      "prompt.id": "p2",
      prompt: "Two questions",
    },
  }),
  rec({
    eventName: "api_request_body",
    spanId: "bb00000000000002",
    timeUnixMs: 200,
    attrs: {
      "event.name": "api_request_body",
      "event.sequence": "2",
      model: "m",
      query_source: "repl_main_thread",
      body: requestBody("first question"),
    },
  }),
  rec({
    eventName: "api_request",
    spanId: "bb00000000000003",
    timeUnixMs: 300,
    attrs: {
      "event.name": "api_request",
      "event.sequence": "3",
      model: "m",
      request_id: "r1",
      query_source: "repl_main_thread",
      cost_usd: "0.01",
    },
  }),
  rec({
    eventName: "api_response_body",
    spanId: "bb00000000000004",
    timeUnixMs: 305,
    attrs: {
      "event.name": "api_response_body",
      "event.sequence": "4",
      model: "m",
      request_id: "r1",
      query_source: "repl_main_thread",
      body: responseBody("first answer"),
    },
  }),
  rec({
    eventName: "api_request_body",
    spanId: "bb00000000000005",
    timeUnixMs: 400,
    attrs: {
      "event.name": "api_request_body",
      "event.sequence": "5",
      model: "m",
      query_source: "repl_main_thread",
      body: requestBody("second question"),
    },
  }),
  rec({
    eventName: "api_request",
    spanId: "bb00000000000006",
    timeUnixMs: 500,
    attrs: {
      "event.name": "api_request",
      "event.sequence": "6",
      model: "m",
      request_id: "r2",
      query_source: "repl_main_thread",
      cost_usd: "0.02",
    },
  }),
  rec({
    eventName: "api_response_body",
    spanId: "bb00000000000007",
    timeUnixMs: 505,
    attrs: {
      "event.name": "api_response_body",
      "event.sequence": "7",
      model: "m",
      request_id: "r2",
      query_source: "repl_main_thread",
      body: responseBody("second answer"),
    },
  }),
];

/**
 * A generated agentic turn of `calls` model calls, each with a preceding tool
 * (decision + result), the tool output fed back by the NEXT call's request body,
 * and interleaved user_prompt at the head. ~5 records per call -> 300 records at
 * calls = 60.
 */
const generatedAgenticTurn = (calls: number): ClaudeCodeLogRecordInput[] => {
  const rows: ClaudeCodeLogRecordInput[] = [];
  let seq = 0;
  let t = 1_000;
  const next = () => {
    seq += 1;
    t += 3;
    return { seq, t };
  };

  const head = next();
  rows.push(
    rec({
      eventName: "user_prompt",
      spanId: "cc00000000000000",
      timeUnixMs: head.t,
      attrs: {
        "event.name": "user_prompt",
        "event.sequence": String(head.seq),
        "session.id": "sg",
        "prompt.id": "pg",
        prompt: "Do many agentic things",
      },
    }),
  );

  for (let i = 0; i < calls; i++) {
    const toolUseId = `toolu_g_${i}`;
    const requestId = `req_g_${i}`;

    // The call's request body (carries the PREVIOUS tool's result, if any).
    const prevToolUseId = i > 0 ? `toolu_g_${i - 1}` : null;
    const b = next();
    rows.push(
      rec({
        eventName: "api_request_body",
        spanId: `cc${(i * 5 + 1).toString(16).padStart(14, "0")}`,
        timeUnixMs: b.t,
        attrs: {
          "event.name": "api_request_body",
          "event.sequence": String(b.seq),
          "session.id": "sg",
          model: "claude-opus-4-8",
          query_source: "repl_main_thread",
          body: prevToolUseId
            ? requestBodyWithToolResult(prevToolUseId, `output-of-${prevToolUseId}`)
            : requestBody(`step ${i}`),
        },
      }),
    );

    // The anchor + response for the call.
    const a = next();
    rows.push(
      rec({
        eventName: "api_request",
        spanId: `cc${(i * 5 + 2).toString(16).padStart(14, "0")}`,
        timeUnixMs: a.t,
        attrs: {
          "event.name": "api_request",
          "event.sequence": String(a.seq),
          "session.id": "sg",
          model: "claude-opus-4-8",
          input_tokens: String(100 + i),
          output_tokens: String(20 + i),
          cost_usd: "0.01",
          duration_ms: "6",
          request_id: requestId,
          query_source: "repl_main_thread",
        },
      }),
    );
    const r = next();
    rows.push(
      rec({
        eventName: "api_response_body",
        spanId: `cc${(i * 5 + 3).toString(16).padStart(14, "0")}`,
        timeUnixMs: r.t,
        attrs: {
          "event.name": "api_response_body",
          "event.sequence": String(r.seq),
          "session.id": "sg",
          model: "claude-opus-4-8",
          request_id: requestId,
          query_source: "repl_main_thread",
          body: responseBody(`answer ${i}`),
        },
      }),
    );

    // The tool decision + result for this call (recovered by the NEXT call).
    const d = next();
    rows.push(
      rec({
        eventName: "tool_decision",
        spanId: `cc${(i * 5 + 4).toString(16).padStart(14, "0")}`,
        timeUnixMs: d.t,
        attrs: {
          "event.name": "tool_decision",
          "event.sequence": String(d.seq),
          "session.id": "sg",
          tool_name: "Bash",
          tool_use_id: toolUseId,
          decision: "accept",
        },
      }),
    );
    const tr = next();
    rows.push(
      rec({
        eventName: "tool_result",
        spanId: `cc${(i * 5 + 5).toString(16).padStart(14, "0")}`,
        timeUnixMs: tr.t,
        attrs: {
          "event.name": "tool_result",
          "event.sequence": String(tr.seq),
          "session.id": "sg",
          tool_name: "Bash",
          tool_use_id: toolUseId,
          success: "true",
          duration_ms: "2",
          tool_input: `{"command":"step-${i}"}`,
        },
      }),
    );
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Normalization: the LAST emission per span id wins (RMT upsert), and the
// per-emission StartTime nudge is dropped so a partial early emission compares
// equal to the completed one on everything BUT the fields that legitimately
// changed (input/output/timing). We compare the winning emissions' full spans.
// ---------------------------------------------------------------------------

/** A stable, JSON-comparable view of a synthesized span, sorted attributes. */
function normalizeSpan(s: SynthesizedClaudeSpan): unknown {
  const span = s.span;
  const attributes = [...span.attributes].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: String(span.startTimeUnixNano),
    endTimeUnixNano: String(span.endTimeUnixNano),
    attributes,
    resource: s.resource,
    instrumentationScope: s.instrumentationScope,
  };
}

/**
 * Collapse a stream of emissions to the winning span per id: the emission with
 * the greatest StartTime wins (ties broken by later emission), modelling the
 * stored_spans `ReplacingMergeTree` read dedup on `max(StartTime)`.
 */
function winningSpans(
  emissions: SynthesizedClaudeSpan[],
): Map<string, SynthesizedClaudeSpan> {
  const winners = new Map<string, SynthesizedClaudeSpan>();
  for (const emission of emissions) {
    const id = emission.span.spanId;
    const prev = winners.get(id);
    if (!prev) {
      winners.set(id, emission);
      continue;
    }
    const prevStart = BigInt(String(prev.span.startTimeUnixNano));
    const nextStart = BigInt(String(emission.span.startTimeUnixNano));
    if (nextStart >= prevStart) winners.set(id, emission);
  }
  return winners;
}

/** The normalized winning-span set keyed by span id, for deep comparison. */
function convergedSet(emissions: SynthesizedClaudeSpan[]): Record<string, unknown> {
  const winners = winningSpans(emissions);
  const out: Record<string, unknown> = {};
  for (const [id, span] of winners) out[id] = normalizeSpan(span);
  return out;
}

// ---------------------------------------------------------------------------
// Partition helper: seeded RNG splits the ordered records into N contiguous
// batches (order preserved, as the repository returns them by cursor).
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so partitions are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split `records` into up to `parts` contiguous batches at random cut points. */
function partition(
  records: ClaudeCodeLogRecordInput[],
  parts: number,
  rng: () => number,
): ClaudeCodeLogRecordInput[][] {
  if (records.length === 0) return [];
  const cuts = new Set<number>();
  const targetCuts = Math.min(parts - 1, Math.max(0, records.length - 1));
  while (cuts.size < targetCuts) {
    cuts.add(1 + Math.floor(rng() * (records.length - 1)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const batches: ClaudeCodeLogRecordInput[][] = [];
  let start = 0;
  for (const cut of sorted) {
    batches.push(records.slice(start, cut));
    start = cut;
  }
  batches.push(records.slice(start));
  return batches.filter((b) => b.length > 0);
}

// ---------------------------------------------------------------------------
// Drivers: run the incremental converter over a partition, optionally with a
// serialize/deserialize round-trip between every batch.
// ---------------------------------------------------------------------------

function runIncremental(
  batches: ClaudeCodeLogRecordInput[][],
  { roundTrip }: { roundTrip: boolean },
): SynthesizedClaudeSpan[] {
  let state: ClaudeTurnConversionState = emptyClaudeTurnConversionState();
  const emissions: SynthesizedClaudeSpan[] = [];
  for (const batch of batches) {
    const result = convertClaudeCodeTurnToSpansIncremental({
      traceId: TRACE,
      records: batch,
      state,
    });
    emissions.push(...result.spans);
    state = result.nextState;
    if (roundTrip) {
      const restored = deserializeClaudeTurnConversionState(
        serializeClaudeTurnConversionState(state),
      );
      expect(restored).not.toBeNull();
      state = restored!;
    }
  }
  return emissions;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TURNS: { name: string; records: () => ClaudeCodeLogRecordInput[] }[] = [
  { name: "a simple tool-using turn", records: simpleToolTurn },
  { name: "a two model-call turn", records: twoModelCallTurn },
  { name: "a generated 300-record agentic turn", records: () => generatedAgenticTurn(60) },
];

describe("incremental Claude Code turn conversion equivalence", () => {
  for (const turn of TURNS) {
    describe(`given ${turn.name}`, () => {
      it("has a whole-turn baseline with the expected shape", () => {
        const records = turn.records();
        const baseline = convertClaudeCodeTurnToSpans(records);
        const set = convergedSet(baseline);
        // A root plus at least one child.
        const roots = Object.values(set).filter(
          (s) => (s as { parentSpanId: string | null }).parentSpanId === null,
        );
        expect(roots).toHaveLength(1);
        expect(Object.keys(set).length).toBeGreaterThan(1);
      });

      describe("when converted incrementally over random batch partitions", () => {
        /** @scenario "losing conversion state re-converts the turn identically" */
        it("converges to the same span set as the single whole-turn pass", () => {
          const records = turn.records();
          const baseline = convergedSet(convertClaudeCodeTurnToSpans(records));

          // 10 seeded partitions per turn.
          for (let seed = 1; seed <= 10; seed++) {
            const rng = mulberry32(seed);
            const parts = 2 + Math.floor(rng() * 9); // 2..10 batches
            const batches = partition(records, parts, rng);
            const incremental = convergedSet(
              runIncremental(batches, { roundTrip: false }),
            );
            expect(incremental).toEqual(baseline);
          }
        });
      });

      describe("when the state is serialized + deserialized between every batch", () => {
        it("still converges to the same span set (state survives a Redis round-trip)", () => {
          const records = turn.records();
          const baseline = convergedSet(convertClaudeCodeTurnToSpans(records));

          for (let seed = 101; seed <= 110; seed++) {
            const rng = mulberry32(seed);
            const parts = 2 + Math.floor(rng() * 9);
            const batches = partition(records, parts, rng);
            const incremental = convergedSet(
              runIncremental(batches, { roundTrip: true }),
            );
            expect(incremental).toEqual(baseline);
          }
        });
      });
    });
  }

  describe("given a model call whose body, anchor, and response each land in a different batch", () => {
    it("converges the completed model span with input and output", () => {
      const records = twoModelCallTurn();
      // One batch per record (the maximal split): every cross-batch model join
      // must complete via the carry set.
      const batches = records.map((r) => [r]);
      const baseline = convergedSet(convertClaudeCodeTurnToSpans(records));
      const incremental = convergedSet(
        runIncremental(batches, { roundTrip: true }),
      );
      expect(incremental).toEqual(baseline);

      // Both model spans ended up complete (input + output present).
      const winners = winningSpans(runIncremental(batches, { roundTrip: true }));
      const models = [...winners.values()].filter(
        (s) =>
          s.span.attributes.find((a) => a.key === "langwatch.span.type")?.value
            ?.stringValue === "llm",
      );
      expect(models).toHaveLength(2);
      for (const model of models) {
        expect(
          model.span.attributes.find((a) => a.key === "gen_ai.input.messages"),
        ).toBeDefined();
        expect(
          model.span.attributes.find((a) => a.key === "gen_ai.completion"),
        ).toBeDefined();
      }
    });
  });

  describe("given a batch boundary exactly between a tool_decision and its api_request_body", () => {
    it("still yields the tool span with its recovered output (re-emitted in pass 2)", () => {
      const records = simpleToolTurn();
      // Cut right before the trailing api_request_body that feeds toolu_1's
      // result back: batch 1 has the tool_result but not its recovering body.
      const feederIndex = records.findIndex(
        (r) =>
          r.eventName === "api_request_body" &&
          (r.attrs.body ?? "").includes("tool_result"),
      );
      expect(feederIndex).toBeGreaterThan(0);
      const batch1 = records.slice(0, feederIndex);
      const batch2 = records.slice(feederIndex);

      const emissions = runIncremental([batch1, batch2], { roundTrip: true });
      const winners = winningSpans(emissions);
      const toolSpan = [...winners.values()].find(
        (s) =>
          s.span.attributes.find((a) => a.key === "langwatch.span.type")?.value
            ?.stringValue === "tool",
      );
      expect(toolSpan).toBeDefined();
      const output = toolSpan!.span.attributes.find(
        (a) => a.key === "langwatch.output",
      )?.value?.stringValue;
      expect(output).toBe("a.txt\nb.txt\nc.txt");
    });
  });

  describe("given the conversion state is lost mid-sequence", () => {
    /** @scenario "losing conversion state re-converts the turn identically" */
    it("re-converts from the start and converges to the whole-turn result", () => {
      const records = generatedAgenticTurn(20);
      const baseline = convergedSet(convertClaudeCodeTurnToSpans(records));

      // Convert the first third with state, then DROP the state (simulate a lost
      // Redis key) and re-convert the WHOLE turn from zero, which is what the
      // reactor does when stateStore.read returns null (cursor resets to zero).
      const rng = mulberry32(7);
      const firstBatches = partition(records.slice(0, records.length / 3), 3, rng);
      const emissions: SynthesizedClaudeSpan[] = [];
      let state: ClaudeTurnConversionState = emptyClaudeTurnConversionState();
      for (const batch of firstBatches) {
        const result = convertClaudeCodeTurnToSpansIncremental({
          traceId: TRACE,
          records: batch,
          state,
        });
        emissions.push(...result.spans);
        state = result.nextState;
      }

      // State lost: reset to zero, refetch from the start, convert the whole
      // turn again (any partition). The upsert (last StartTime wins) still lands
      // the same converged tree.
      const redrawBatches = partition(records, 5, mulberry32(9));
      emissions.push(...runIncremental(redrawBatches, { roundTrip: false }));

      expect(convergedSet(emissions)).toEqual(baseline);
    });
  });

  describe("given a batch that carries only the user_prompt (no model/tool yet)", () => {
    it("emits no spans but advances state so the next batch builds the root", () => {
      const records = simpleToolTurn();
      const promptOnly = records.slice(0, 1);
      const rest = records.slice(1);

      const first = convertClaudeCodeTurnToSpansIncremental({
        traceId: TRACE,
        records: promptOnly,
        state: emptyClaudeTurnConversionState(),
      });
      expect(first.spans).toEqual([]);
      // The prompt text is captured in state for the root the next batch builds.
      expect(first.nextState.root.input).toBe("List /tmp");

      const second = convertClaudeCodeTurnToSpansIncremental({
        traceId: TRACE,
        records: rest,
        state: first.nextState,
      });
      const root = second.spans.find((s) => s.span.parentSpanId === null);
      expect(root).toBeDefined();
      const input = root!.span.attributes.find(
        (a) => a.key === "langwatch.input",
      )?.value?.stringValue;
      expect(input).toBe("List /tmp");
    });
  });
});

describe("claude turn conversion state serialization bounds", () => {
  describe("given a state with an oversized carry set and prompt map", () => {
    it("caps the carry set and prompt map on serialize", () => {
      const state = emptyClaudeTurnConversionState();
      for (let i = 0; i < 200; i++) {
        state.carryRecords.push({
          spanId: `sp${i.toString(16).padStart(14, "0")}`,
          timeUnixMs: i,
          eventName: "api_request_body",
          attrs: { "event.sequence": String(i), body: "x" },
        });
      }
      for (let i = 0; i < 100; i++) state.promptTextById[`p_${i}`] = `text ${i}`;

      const restored = deserializeClaudeTurnConversionState(
        serializeClaudeTurnConversionState(state),
      );
      expect(restored).not.toBeNull();
      expect(restored!.carryRecords.length).toBeLessThanOrEqual(64);
      expect(Object.keys(restored!.promptTextById).length).toBeLessThanOrEqual(16);
    });
  });

  describe("given corrupt persisted state", () => {
    it("reads back as null so the reactor re-converts from zero", () => {
      expect(deserializeClaudeTurnConversionState(null)).toBeNull();
      expect(deserializeClaudeTurnConversionState("not json")).toBeNull();
      expect(deserializeClaudeTurnConversionState("{}")).toBeNull();
      expect(deserializeClaudeTurnConversionState('{"cursor":{}}')).toBeNull();
    });
  });

  describe("given a zero (empty) state", () => {
    it("round-trips the Infinity start sentinel back to Infinity", () => {
      const restored = deserializeClaudeTurnConversionState(
        serializeClaudeTurnConversionState(emptyClaudeTurnConversionState()),
      );
      expect(restored).not.toBeNull();
      expect(restored!.root.startMs).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
