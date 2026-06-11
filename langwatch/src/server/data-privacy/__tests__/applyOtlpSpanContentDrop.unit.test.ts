import { describe, expect, it } from "vitest";

import { stripOtlpSpanContent } from "../applyOtlpSpanContentDrop";
import { PRIVACY_DROPPED_MARKER_ATTR } from "../dropKeyCatalog";
import {
  EMPTY_AUDIENCE,
  type Disposition,
  type ResolvedDataPrivacy,
} from "../dataPrivacy.types";
import type {
  OtlpKeyValue,
  OtlpSpan,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

function policy({
  input = "capture" as Disposition,
  output = "capture" as Disposition,
  system = "capture" as Disposition,
  tools = "capture" as Disposition,
  customDropKeys = [] as string[],
}): ResolvedDataPrivacy {
  const cat = (disposition: Disposition) => ({
    disposition,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: {
      input: cat(input),
      output: cat(output),
      system: cat(system),
      tools: cat(tools),
    },
    pii: { level: "essential" },
    secrets: { enabled: true, customPatterns: [] },
    customDropKeys,
  };
}

function kv(record: Record<string, string>): OtlpKeyValue[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

function span(
  attributes: Record<string, string>,
  events: Record<string, string>[] = [],
): OtlpSpan {
  return {
    traceId: "t",
    spanId: "s",
    name: "span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: kv(attributes),
    events: events.map((attrs, i) => ({
      name: `event-${i}`,
      timeUnixNano: { low: 0, high: 0 },
      attributes: kv(attrs),
      droppedAttributesCount: 0,
    })),
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function keys(span: OtlpSpan): string[] {
  return span.attributes.map((a) => a.key);
}

function marker(span: OtlpSpan): string | undefined {
  return span.attributes.find((a) => a.key === PRIVACY_DROPPED_MARKER_ATTR)
    ?.value.stringValue ?? undefined;
}

describe("stripOtlpSpanContent", () => {
  describe("given a span carrying every content category plus metadata", () => {
    describe("when every category is dropped", () => {
      /** @scenario Metadata always survives a drop */
      it("removes all content keys but keeps token, cost, model, and latency metadata", () => {
        const s = span({
          "gen_ai.input.messages": "hello",
          "gen_ai.output.messages": "hi there",
          "gen_ai.system_instructions": "be nice",
          "gen_ai.tool.call.arguments": "{}",
          "gen_ai.usage.input_tokens": "12",
          "gen_ai.usage.output_tokens": "8",
          "gen_ai.usage.cost": "0.0003",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.response.duration": "1200",
        });

        stripOtlpSpanContent({
          span: s,
          policy: policy({
            input: "drop",
            output: "drop",
            system: "drop",
            tools: "drop",
          }),
        });

        expect(keys(s)).not.toContain("gen_ai.input.messages");
        expect(keys(s)).not.toContain("gen_ai.output.messages");
        expect(keys(s)).not.toContain("gen_ai.system_instructions");
        expect(keys(s)).not.toContain("gen_ai.tool.call.arguments");
        expect(keys(s)).toContain("gen_ai.usage.input_tokens");
        expect(keys(s)).toContain("gen_ai.usage.output_tokens");
        expect(keys(s)).toContain("gen_ai.usage.cost");
        expect(keys(s)).toContain("gen_ai.request.model");
        expect(keys(s)).toContain("gen_ai.response.duration");
      });
    });
  });

  describe("given a span with input, output, and tool calls", () => {
    describe("when only tool calls are dropped", () => {
      /** @scenario Each content category is dropped independently */
      it("keeps input and output but removes tool-call arguments and results", () => {
        const s = span({
          "gen_ai.input.messages": "hello",
          "gen_ai.output.messages": "hi",
          "gen_ai.tool.call.arguments": "{}",
          "gen_ai.tool.call.result": "ok",
        });

        stripOtlpSpanContent({ span: s, policy: policy({ tools: "drop" }) });

        expect(keys(s)).toContain("gen_ai.input.messages");
        expect(keys(s)).toContain("gen_ai.output.messages");
        expect(keys(s)).not.toContain("gen_ai.tool.call.arguments");
        expect(keys(s)).not.toContain("gen_ai.tool.call.result");
        expect(marker(s)).toBe("tools");
      });
    });
  });

  describe("given a coding-agent span with a raw request body and a completion", () => {
    describe("when input is dropped", () => {
      /** @scenario A coding-agent's full request body is never stored when input is dropped */
      it("removes the raw request body carried under gen_ai.prompt but keeps the completion", () => {
        const s = span({
          "gen_ai.prompt": "FULL RAW REQUEST BODY",
          "gen_ai.completion": "the answer",
        });

        stripOtlpSpanContent({ span: s, policy: policy({ input: "drop" }) });

        expect(keys(s)).not.toContain("gen_ai.prompt");
        expect(keys(s)).toContain("gen_ai.completion");
        expect(marker(s)).toBe("input");
      });
    });
  });

  describe("given a span with a custom blacklisted attribute key", () => {
    describe("when the policy lists that key in customDropKeys", () => {
      /** @scenario Extra blacklisted attribute keys are dropped */
      it("removes the custom key without touching captured categories", () => {
        const s = span({
          "http.request.body": "secret payload",
          "gen_ai.input.messages": "hello",
        });

        stripOtlpSpanContent({
          span: s,
          policy: policy({ customDropKeys: ["http.request.body"] }),
        });

        expect(keys(s)).not.toContain("http.request.body");
        expect(keys(s)).toContain("gen_ai.input.messages");
        // No category was dropped, so no category marker is stamped.
        expect(marker(s)).toBeUndefined();
      });
    });
  });

  describe("given dropped content also lives on a span event", () => {
    describe("when input is dropped", () => {
      it("strips the dropped keys from event attributes too", () => {
        const s = span({ "gen_ai.request.model": "gpt-5-mini" }, [
          { "gen_ai.input.messages": "hello", "gen_ai.usage.input_tokens": "5" },
        ]);

        stripOtlpSpanContent({ span: s, policy: policy({ input: "drop" }) });

        const eventKeys = s.events[0]!.attributes.map((a) => a.key);
        expect(eventKeys).not.toContain("gen_ai.input.messages");
        expect(eventKeys).toContain("gen_ai.usage.input_tokens");
      });
    });
  });

  describe("given nothing is configured to drop", () => {
    describe("when the span is stripped", () => {
      it("leaves the span untouched and stamps no marker", () => {
        const s = span({ "gen_ai.input.messages": "hello" });

        const result = stripOtlpSpanContent({ span: s, policy: policy({}) });

        expect(result.droppedCount).toBe(0);
        expect(keys(s)).toEqual(["gen_ai.input.messages"]);
        expect(marker(s)).toBeUndefined();
      });
    });
  });
});
