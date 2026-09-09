import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { traceServerConfigDefinition } from "../trace.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "trace", definition: traceServerConfigDefinition, source }).value;

describe("trace server configuration", () => {
  describe("given the tokenizer timeout is written the way the tokenizer reads it", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it as written, so a duration the tokenizer accepts is not refused here", () => {
      expect(read({ TIKTOKEN_FETCH_TIMEOUT_MS: "10s" }).tokenizer.fetchTimeoutMs).toBe("10s");
    });
  });

  describe("given the span pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      expect(read({ TRACE_SPAN_PROCESSING_SHARDS: "8" }).spanProcessingShards).toBe("8");
    });
  });
});
