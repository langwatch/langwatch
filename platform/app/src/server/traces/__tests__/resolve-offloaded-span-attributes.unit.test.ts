/**
 * The ADR-022 resolver primitive, on its own (#5753).
 *
 * `resolveOffloadedSpanAttributes` is the per-span unit `resolveOffloadedTraces`
 * runs across a trace, and the unit the prompt-studio read calls directly. These
 * are its two contracts: what a restored span carries, and what an untouched one
 * keeps. The read paths that use it are covered next door in
 * `clickhouse-trace.service-prompt-studio-resolution.unit.test.ts`.
 *
 * Pure: no ClickHouse, no App, no module mocks. It parses attributes and calls
 * the BlobStore stub it is handed.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { createLogger } from "@langwatch/observability";
import { describe, expect, it } from "vitest";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  resolveOffloadedSpanAttributes,
  resolveOffloadedTraces,
} from "../resolve-offloaded-traces";
import {
  fullInput,
  LLM_SPAN_ID,
  llmRowWithEventRef,
  makeBlobStore,
  normalized,
  PROJECT_ID,
  previewInput,
  SIBLING_SPAN_ID,
  TRACE_ID,
} from "./fixtures/prompt-studio-offload-fixtures";

/**
 * Asserted at the resolver boundary, because that is the only place the
 * attributes exist. `PromptStudioSpanResult` carries messages and llm config,
 * never the raw attribute map, so checking the prompt-studio result for a
 * reserved key passes whether or not the key was stripped.
 */
describe("resolveOffloadedSpanAttributes, restored content (#5753)", () => {
  describe("given a span whose input was offloaded", () => {
    describe("when its attributes are resolved", () => {
      /** @scenario "Restored content replaces the pointer rather than sitting beside it" */
      it("puts the full value under the plain key and leaves no pointer behind", async () => {
        const { blobStore } = makeBlobStore({ "langwatch.input": fullInput });

        const { attributes } = await resolveOffloadedSpanAttributes({
          projectId: PROJECT_ID,
          traceId: TRACE_ID,
          spanId: LLM_SPAN_ID,
          attributes: llmRowWithEventRef().SpanAttributes,
          blobStore,
          logger: createLogger("test"),
        });

        expect(attributes["langwatch.input"]).toBe(fullInput);
        expect(
          Object.keys(attributes).filter((key) =>
            key.startsWith(EVENTREF_ATTR_PREFIX),
          ),
        ).toEqual([]);
      });
    });
  });
});

/**
 * The primitive's own contract. resolveOffloadedTraces relies on it to leave
 * the spans it has nothing to do for alone: one offloaded span in a thousand-
 * span trace must not rewrite the other nine hundred and ninety-nine.
 */
describe("resolveOffloadedSpanAttributes, untouched spans (#5753)", () => {
  describe("given a trace where only one span carries an eventref", () => {
    describe("when the trace's spans are resolved", () => {
      /** @scenario "One offloaded span does not disturb the rest of the trace" */
      it("leaves the span without one showing exactly its stored content", async () => {
        const { blobStore } = makeBlobStore({ "langwatch.input": fullInput });
        const plain = normalized({
          spanId: SIBLING_SPAN_ID,
          spanAttributes: { "langwatch.input": previewInput },
        });
        const offloaded = normalized({
          spanId: LLM_SPAN_ID,
          spanAttributes: {
            "langwatch.input": previewInput,
            [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
              field: "langwatch.input",
              eventId: "evt-1",
            }),
          },
        });

        const { resolvedSpans } = await resolveOffloadedTraces({
          projectId: PROJECT_ID,
          normalizedSpans: [plain, offloaded],
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
          logger: createLogger("test"),
        });

        expect(resolvedSpans[0]?.spanAttributes["langwatch.input"]).toBe(
          previewInput,
        );
        // Identity, not just equality: leaving the object alone is HOW the
        // untouched span stays untouched, and it is what keeps one offloaded
        // span in a large trace from rewriting all the others.
        expect(resolvedSpans[0]).toBe(plain);
        expect(resolvedSpans[1]).not.toBe(offloaded);
        expect(resolvedSpans[1]?.spanAttributes["langwatch.input"]).toBe(
          fullInput,
        );
      });
    });
  });
});
