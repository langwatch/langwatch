import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { traceConfig } from "../trace.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "trace", config: traceConfig }], environment }).trace;

describe("trace server configuration", () => {
  describe("given the tokenizer timeout is written the way the tokenizer reads it", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it as written, so a duration the tokenizer accepts is not refused here", () => {
      expect(read({ TIKTOKEN_FETCH_TIMEOUT_MS: "10s" }).tokenizer.fetchTimeoutMs).toBe("10s");
    });
  });

  describe("given a deployment setting the tokenizer path and fetch timeout", () => {
    /** @scenario "The two tokenizer variables are read at the application's spellings" */
    it("reads TIKTOKENS_PATH and TIKTOKEN_FETCH_TIMEOUT_MS into the tokenizer slice", () => {
      expect(
        read({ TIKTOKENS_PATH: "/srv/bpe", TIKTOKEN_FETCH_TIMEOUT_MS: "2500" }).tokenizer,
      ).toEqual({ bpeDirectory: "/srv/bpe", fetchTimeoutMs: "2500" });
    });
  });

  describe("given the span pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      expect(read({ TRACE_SPAN_PROCESSING_SHARDS: "8" }).spanProcessingShards).toBe("8");
    });
  });
});
