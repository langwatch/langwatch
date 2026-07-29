import { describe, expect, it } from "vitest";

import {
  type ClaudeContentLog,
  type ClaudeSpanRef,
  type ClaudeToolLog,
  computeClaudeInteractionOutput,
  computeClaudeSpanEnrichment,
  computeClaudeToolSpanEnrichment,
} from "../claude-code-span-enrichment";

/**
 * Real (sanitized) claude_code request id shape — `req_011Ccu...`.
 * A model call span carries this on its `request_id` attribute; the matching
 * `api_response_body` log carries the same id, so output is joined exactly.
 */
const REQUEST_ID = "req_011CcuGBf1aBcDeFgHiJkLmN";

function responseBody(text: string): string {
  return JSON.stringify({
    id: "msg_01xyz",
    role: "assistant",
    content: [{ type: "text", text }],
  });
}

function requestBody({
  system,
  userText,
}: {
  system?: string;
  userText: string;
}): string {
  return JSON.stringify({
    model: "claude-sonnet-4",
    ...(system !== undefined ? { system } : {}),
    messages: [{ role: "user", content: userText }],
  });
}

const REPL = "repl_main_thread";

describe("computeClaudeSpanEnrichment", () => {
  describe("given a span and a response body with the same request_id", () => {
    it("attaches the assistant text as the span output", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_response_body",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: responseBody("Here is your answer."),
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });

      const output = result.get("span-1")?.output;
      expect(output).toEqual({ type: "text", value: "Here is your answer." });
    });

    it("keeps tool_use markers so a tool-deciding turn still shows what it did", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_response_body",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: JSON.stringify({
            content: [
              { type: "tool_use", name: "Bash", input: { command: "ls" } },
            ],
          }),
        },
      ];

      const output = computeClaudeSpanEnrichment({ spans, logs }).get(
        "span-1",
      )?.output;
      expect(output?.type).toBe("text");
      expect((output as { value: string }).value).toContain("[tool_use: Bash]");
    });
  });

  describe("given a response body whose request_id matches no span", () => {
    it("does not attach output to the non-matching span", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: "req_someOtherId", querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_response_body",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: responseBody("Unrelated reply"),
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });

      expect(result.get("span-1")?.output ?? null).toBeNull();
    });
  });

  describe("given N request bodies (no request_id) within one query_source", () => {
    it("pairs the Nth request body to the Nth span in timestamp order", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: "req_a", querySource: REPL },
        { spanId: "span-2", requestId: "req_b", querySource: REPL },
        { spanId: "span-3", requestId: "req_c", querySource: REPL },
      ];
      // Deliberately out of time order to prove sorting by timeUnixMs.
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 300,
          body: requestBody({ userText: "third" }),
        },
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          body: requestBody({ userText: "first" }),
        },
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 200,
          body: requestBody({ userText: "second" }),
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });

      const contentOf = (spanId: string): string => {
        const input = result.get(spanId)?.input;
        expect(input?.type).toBe("chat_messages");
        const messages = (input as { value: Array<{ content: string }> }).value;
        return messages.map((m) => m.content).join(" ");
      };
      expect(contentOf("span-1")).toContain("first");
      expect(contentOf("span-2")).toContain("second");
      expect(contentOf("span-3")).toContain("third");
    });
  });

  describe("given two query_sources each with their own request bodies", () => {
    it("does not leak input content across query_sources", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-main", requestId: "req_a", querySource: REPL },
        { spanId: "span-sub", requestId: "req_b", querySource: "sidechain" },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          body: requestBody({ userText: "MAIN_THREAD_PROMPT" }),
        },
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: "sidechain",
          timeUnixMs: 110,
          body: requestBody({ userText: "SIDECHAIN_PROMPT" }),
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });

      const contentOf = (spanId: string): string => {
        const input = result.get(spanId)?.input as {
          value: Array<{ content: string }>;
        };
        return input.value.map((m) => m.content).join(" ");
      };
      expect(contentOf("span-main")).toContain("MAIN_THREAD_PROMPT");
      expect(contentOf("span-main")).not.toContain("SIDECHAIN_PROMPT");
      expect(contentOf("span-sub")).toContain("SIDECHAIN_PROMPT");
      expect(contentOf("span-sub")).not.toContain("MAIN_THREAD_PROMPT");
    });
  });

  describe("given two CONCURRENT sub-agents sharing one query_source (known-fragile positional input pairing)", () => {
    /**
     * Residual limitation, characterized deliberately. Input logs
     * (`api_request_body` / `user_prompt`) carry NO `request_id`, so input can
     * only be paired positionally: the Nth span (array/call order) to the Nth
     * body (time order). That holds for ONE sequential agent. Two concurrent
     * sub-agents emitting under the SAME `query_source` interleave in a single
     * group, so when the span array order and the body time order disagree, span
     * i pairs with the OTHER agent's body i — input is mis-attributed.
     *
     * This is accepted: output and cost still join EXACTLY by `request_id`
     * (asserted below), only the input transcript can cross; and real Claude
     * Code sub-agents each carry a distinct `query_source`, which isolates them
     * into separate groups (see the two-query_sources test above). This test
     * pins the behavior so a future correlation fix has a red-to-green target.
     */
    it("joins output/cost exactly by request_id but can cross the positional input", () => {
      const REQ_A = "req_agentA";
      const REQ_B = "req_agentB";
      // Array/call order: agent A's span first, then agent B's.
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-A", requestId: REQ_A, querySource: REPL },
        { spanId: "span-B", requestId: REQ_B, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        // Agent B's request body lands FIRST in time (its model call started
        // earlier under concurrency), so body time order is [B, A] — the
        // reverse of the span array order.
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          body: requestBody({ userText: "AGENT_B_PROMPT" }),
        },
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 200,
          body: requestBody({ userText: "AGENT_A_PROMPT" }),
        },
        // Output + cost carry request_id, so they join exactly regardless of order.
        {
          eventName: "api_request",
          requestId: REQ_A,
          querySource: REPL,
          timeUnixMs: 205,
          body: null,
          costUsd: 0.03,
        },
        {
          eventName: "api_response_body",
          requestId: REQ_A,
          querySource: REPL,
          timeUnixMs: 210,
          body: responseBody("ANSWER_A"),
        },
        {
          eventName: "api_request",
          requestId: REQ_B,
          querySource: REPL,
          timeUnixMs: 105,
          body: null,
          costUsd: 0.07,
        },
        {
          eventName: "api_response_body",
          requestId: REQ_B,
          querySource: REPL,
          timeUnixMs: 110,
          body: responseBody("ANSWER_B"),
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });

      // Output + cost: EXACT by request_id — never crossed.
      expect((result.get("span-A")?.output as { value: string }).value).toBe(
        "ANSWER_A",
      );
      expect(result.get("span-A")?.cost).toBe(0.03);
      expect((result.get("span-B")?.output as { value: string }).value).toBe(
        "ANSWER_B",
      );
      expect(result.get("span-B")?.cost).toBe(0.07);

      // Input: POSITIONAL — span-A (array index 0) pairs with the earliest body
      // (agent B's), so the transcript crosses. Documented limitation.
      const inputOf = (spanId: string): string =>
        (
          result.get(spanId)?.input as { value: Array<{ content: string }> }
        ).value
          .map((m) => m.content)
          .join(" ");
      expect(inputOf("span-A")).toContain("AGENT_B_PROMPT");
      expect(inputOf("span-B")).toContain("AGENT_A_PROMPT");
    });
  });

  describe("given the request body is truncated (unparseable JSON)", () => {
    it("falls back to the user_prompt text for the span input", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: "req_a", querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "user_prompt",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 90,
          body: "please summarise the repo",
        },
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          // Inline-truncated body: valid JSON prefix, no closing braces.
          body: '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"please su',
        },
      ];

      const input = computeClaudeSpanEnrichment({ spans, logs }).get(
        "span-1",
      )?.input;

      expect(input).toEqual({
        type: "text",
        value: "please summarise the repo",
      });
    });
  });

  describe("given a 1.5MB response body", () => {
    it("caps the attached output value", () => {
      const huge = "x".repeat(1_500_000);
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "assistant_response",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: huge,
        },
      ];

      const output = computeClaudeSpanEnrichment({ spans, logs }).get("span-1")
        ?.output as { type: "text"; value: string };

      expect(output.value.length).toBeLessThan(huge.length);
      expect(Buffer.byteLength(output.value, "utf8")).toBeLessThanOrEqual(
        256 * 1024,
      );
      expect(output.value).toContain("langwatch: truncated");
    });
  });

  describe("given no claude content logs", () => {
    it("returns an empty map, leaving every span untouched", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
        { spanId: "span-2", requestId: "req_b", querySource: REPL },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs: [] });

      expect(result.size).toBe(0);
    });
  });

  describe("given an api_request anchor with cost_usd sharing the span's request_id", () => {
    it("attaches the authoritative cost to the span", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: null,
          costUsd: 0.0421,
        },
      ];

      const enrichment = computeClaudeSpanEnrichment({ spans, logs }).get(
        "span-1",
      );

      expect(enrichment?.cost).toBe(0.0421);
    });

    it("does not attach cost to a span whose request_id matches no api_request", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: "req_unmatched", querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 1000,
          body: null,
          costUsd: 0.5,
        },
      ];

      expect(
        computeClaudeSpanEnrichment({ spans, logs }).get("span-1")?.cost ??
          null,
      ).toBeNull();
    });
  });

  describe("given an api_request with an invalid cost_usd", () => {
    it("does not attach a negative or non-finite cost", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-neg", requestId: "req_neg", querySource: REPL },
        { spanId: "span-nan", requestId: "req_nan", querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request",
          requestId: "req_neg",
          querySource: REPL,
          timeUnixMs: 1,
          body: null,
          costUsd: -1,
        },
        {
          eventName: "api_request",
          requestId: "req_nan",
          querySource: REPL,
          timeUnixMs: 2,
          body: null,
          costUsd: Number.NaN,
        },
      ];

      const result = computeClaudeSpanEnrichment({ spans, logs });
      expect(result.get("span-neg") ?? null).toBeNull();
      expect(result.get("span-nan") ?? null).toBeNull();
    });
  });

  describe("given the light events only (RAW_API_BODIES off: assistant_response + user_prompt + api_request)", () => {
    it("joins output + cost exactly by request_id and input from the user_prompt, without any api_*_body", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "user_prompt",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          body: "summarise the repo",
        },
        {
          eventName: "api_request",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 200,
          body: null,
          costUsd: 0.0123,
        },
        {
          eventName: "assistant_response",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 210,
          body: "Here is the summary.",
        },
      ];

      const enrichment = computeClaudeSpanEnrichment({ spans, logs }).get(
        "span-1",
      );

      expect(enrichment?.output).toEqual({
        type: "text",
        value: "Here is the summary.",
      });
      expect(enrichment?.cost).toBe(0.0123);
      expect(enrichment?.input).toEqual({
        type: "text",
        value: "summarise the repo",
      });
    });
  });

  describe("given both a request body and a response body for one span", () => {
    it("attaches input from the body and output from the matching response", () => {
      const spans: ClaudeSpanRef[] = [
        { spanId: "span-1", requestId: REQUEST_ID, querySource: REPL },
      ];
      const logs: ClaudeContentLog[] = [
        {
          eventName: "api_request_body",
          requestId: null,
          querySource: REPL,
          timeUnixMs: 100,
          body: requestBody({
            system: "You are helpful",
            userText: "hi there",
          }),
        },
        {
          eventName: "api_response_body",
          requestId: REQUEST_ID,
          querySource: REPL,
          timeUnixMs: 200,
          body: responseBody("hello!"),
        },
      ];

      const enrichment = computeClaudeSpanEnrichment({ spans, logs }).get(
        "span-1",
      );

      expect(enrichment?.output).toEqual({ type: "text", value: "hello!" });
      expect(enrichment?.input?.type).toBe("chat_messages");
      const messages = (
        enrichment?.input as { value: Array<{ role: string; content: string }> }
      ).value;
      expect(messages).toEqual([
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hi there" },
      ]);
    });
  });
});

function toolLog(over: Partial<ClaudeToolLog> = {}): ClaudeToolLog {
  return {
    eventName: "tool_result",
    toolUseId: "toolu_01AbCdEfGhIjKlMnOpQrStUv",
    toolName: "Bash",
    toolParameters: '{"command":"wc -l notes.txt"}',
    toolInput: '{"command":"wc -l notes.txt","description":"Count lines"}',
    decision: null,
    decisionSource: "config",
    success: true,
    durationMs: 820,
    resultSizeBytes: 799,
    timeUnixMs: 2000,
    ...over,
  };
}

function contentLog(over: Partial<ClaudeContentLog> = {}): ClaudeContentLog {
  return {
    eventName: "api_request_body",
    requestId: null,
    querySource: REPL,
    timeUnixMs: 3000,
    body: null,
    ...over,
  };
}

describe("computeClaudeToolSpanEnrichment", () => {
  const TOOL_USE_ID = "toolu_01AbCdEfGhIjKlMnOpQrStUv";

  describe("given a tool span and its tool_result log", () => {
    it("attaches the real tool_input as the span input", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [toolLog()],
        contentLogs: [],
      });

      expect(result.get("tool-span-1")?.input).toEqual({
        type: "json",
        value: { command: "wc -l notes.txt", description: "Count lines" },
      });
    });

    it("summarises the outcome as output when no request body carries the result content", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [toolLog()],
        contentLogs: [],
      });

      expect(result.get("tool-span-1")?.output).toEqual({
        type: "json",
        value: {
          status: "completed",
          success: true,
          durationMs: 820,
          resultSizeBytes: 799,
          decisionSource: "config",
        },
      });
    });

    it("reports failed runs distinctly", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [toolLog({ success: false })],
        contentLogs: [],
      });

      expect(result.get("tool-span-1")?.output).toMatchObject({
        type: "json",
        value: { status: "failed", success: false },
      });
    });
  });

  describe("given the next model call's request body carrying the tool_result block", () => {
    it("recovers the REAL tool output content keyed by tool_use_id", () => {
      const body = JSON.stringify({
        model: "claude-sonnet-4",
        messages: [
          { role: "user", content: "count the lines" },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: {} },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: TOOL_USE_ID,
                content: [{ type: "text", text: "42 notes.txt" }],
              },
            ],
          },
        ],
      });

      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [toolLog()],
        contentLogs: [contentLog({ body })],
      });

      expect(result.get("tool-span-1")?.output).toEqual({
        type: "text",
        value: "42 notes.txt",
      });
    });
  });

  describe("given a denied tool (decision without a result)", () => {
    it("reports the rejection as the output", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [
          toolLog({
            eventName: "tool_decision",
            decision: "reject",
            decisionSource: "user_temporary",
            toolInput: null,
            success: null,
            durationMs: null,
            resultSizeBytes: null,
          }),
        ],
        contentLogs: [],
      });

      const enrichment = result.get("tool-span-1");
      expect(enrichment?.output).toEqual({
        type: "json",
        value: {
          status: "rejected",
          decision: "reject",
          decisionSource: "user_temporary",
        },
      });
      expect(enrichment?.input).toEqual({
        type: "json",
        value: { command: "wc -l notes.txt" },
      });
    });
  });

  describe("given malformed tool_input JSON", () => {
    it("keeps the raw string as text input", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: TOOL_USE_ID }],
        toolLogs: [toolLog({ toolInput: "{not json" })],
        contentLogs: [],
      });

      expect(result.get("tool-span-1")?.input).toEqual({
        type: "text",
        value: "{not json",
      });
    });
  });

  describe("given a tool span with no matching logs", () => {
    it("leaves the span untouched", () => {
      const result = computeClaudeToolSpanEnrichment({
        spans: [{ spanId: "tool-span-1", toolUseId: "toolu_unmatched" }],
        toolLogs: [toolLog()],
        contentLogs: [],
      });

      expect(result.has("tool-span-1")).toBe(false);
    });
  });
});

describe("computeClaudeInteractionOutput", () => {
  describe("given conversational replies inside the turn window", () => {
    it("picks the LAST reply as the turn's output", () => {
      const output = computeClaudeInteractionOutput({
        logs: [
          contentLog({
            eventName: "assistant_response",
            requestId: "req_a",
            timeUnixMs: 1500,
            body: "first reply",
          }),
          contentLog({
            eventName: "assistant_response",
            requestId: "req_b",
            timeUnixMs: 2500,
            body: "final reply",
          }),
        ],
        windowStartMs: 1000,
        windowEndMs: 3000,
      });

      expect(output).toEqual({ type: "text", value: "final reply" });
    });

    it("prefers the parsed response body over the raw text at the same timestamp", () => {
      const output = computeClaudeInteractionOutput({
        logs: [
          contentLog({
            eventName: "assistant_response",
            requestId: "req_a",
            timeUnixMs: 2000,
            body: "raw text",
          }),
          contentLog({
            eventName: "api_response_body",
            requestId: "req_a",
            timeUnixMs: 2000,
            body: responseBody("parsed body reply"),
          }),
        ],
        windowStartMs: 1000,
        windowEndMs: 3000,
      });

      expect(output).toEqual({ type: "text", value: "parsed body reply" });
    });
  });

  describe("given a utility reply (non-conversational query source)", () => {
    it("never lets it headline the turn", () => {
      const output = computeClaudeInteractionOutput({
        logs: [
          contentLog({
            eventName: "assistant_response",
            requestId: "req_a",
            querySource: "generate_session_title",
            timeUnixMs: 2000,
            body: "Telemetry chat",
          }),
        ],
        windowStartMs: 1000,
        windowEndMs: 3000,
      });

      expect(output).toBeNull();
    });
  });

  describe("given a reply flushed just after the span closed", () => {
    it("accepts it within the 2s slack", () => {
      const output = computeClaudeInteractionOutput({
        logs: [
          contentLog({
            eventName: "assistant_response",
            requestId: "req_a",
            timeUnixMs: 4500,
            body: "late flush",
          }),
        ],
        windowStartMs: 1000,
        windowEndMs: 3000,
      });

      expect(output).toEqual({ type: "text", value: "late flush" });
    });

    it("rejects replies beyond the slack (another turn's reply)", () => {
      const output = computeClaudeInteractionOutput({
        logs: [
          contentLog({
            eventName: "assistant_response",
            requestId: "req_a",
            timeUnixMs: 9000,
            body: "next turn",
          }),
        ],
        windowStartMs: 1000,
        windowEndMs: 3000,
      });

      expect(output).toBeNull();
    });
  });

  describe("given no logs", () => {
    it("returns null", () => {
      expect(
        computeClaudeInteractionOutput({
          logs: [],
          windowStartMs: 0,
          windowEndMs: 1,
        }),
      ).toBeNull();
    });
  });
});
