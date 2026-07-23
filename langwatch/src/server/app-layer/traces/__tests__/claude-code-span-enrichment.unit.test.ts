import { describe, it, expect } from "vitest";

import {
  computeClaudeSpanEnrichment,
  type ClaudeContentLog,
  type ClaudeSpanRef,
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
            content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
          }),
        },
      ];

      const output = computeClaudeSpanEnrichment({ spans, logs }).get("span-1")
        ?.output;
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

      const input = computeClaudeSpanEnrichment({ spans, logs }).get("span-1")
        ?.input;

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
        computeClaudeSpanEnrichment({ spans, logs }).get("span-1")?.cost ?? null,
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
          body: requestBody({ system: "You are helpful", userText: "hi there" }),
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
