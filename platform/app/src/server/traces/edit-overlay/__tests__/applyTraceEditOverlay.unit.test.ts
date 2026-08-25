/**
 * @vitest-environment node
 *
 * Applying a correction over a captured trace. Every case here is pure: the
 * same functions run on the server for the dataset read and in the browser for
 * the drawer's edited/original toggle.
 */
import { describe, expect, it } from "vitest";
import { datasetSpanSchema } from "@langwatch/dataset-contract";
import type { Span, Trace } from "~/server/tracer/types";
import { applyOverlayToTrace, expandDeletedSpanIds } from "../applyTraceEditOverlay";
import {
  applyOverlayToSpanDetail,
  applyOverlayToSpanTreeNodes,
  applyOverlayToTraceHeader,
  changedSpanFields,
  changedTraceMetadataKeys,
} from "../applyTraceEditOverlayToViews";
import type { TraceEditOverlayPatch } from "../traceEditOverlay.schemas";

const span = (overrides: Partial<Span> & Pick<Span, "span_id">): Span =>
  ({
    trace_id: "trace-1",
    parent_id: null,
    type: "span",
    name: "captured",
    timestamps: { started_at: 1_000, finished_at: 2_000 },
    metrics: { prompt_tokens: 7, completion_tokens: 3 },
    ...overrides,
  }) as Span;

const trace = (spans: Span[], overrides: Partial<Trace> = {}): Trace =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
    input: { value: "captured input" },
    output: { value: "captured output" },
    spans,
    ...overrides,
  }) as Trace;

const patchOf = (overrides: Partial<TraceEditOverlayPatch>): TraceEditOverlayPatch => ({
  version: 1,
  spans: [],
  deletedSpanIds: [],
  ...overrides,
});

describe("applying a trace correction", () => {
  describe("given a correction that rewrites a span field", () => {
    /** @scenario "An edited span field replaces the whole field" */
    it("replaces the whole field and leaves timings and metrics alone", () => {
      const original = trace([
        span({
          span_id: "span-1",
          output: { type: "text", value: "captured output" },
        }),
      ]);

      const corrected = applyOverlayToTrace({
        trace: original,
        patch: patchOf({
          spans: [
            {
              spanId: "span-1",
              output: { type: "text", value: "corrected output" },
            },
          ],
        }),
      });

      expect(corrected.spans[0]?.output).toEqual({
        type: "text",
        value: "corrected output",
      });
      expect(corrected.spans[0]?.timestamps).toEqual(original.spans[0]?.timestamps);
      expect(corrected.spans[0]?.metrics).toEqual(original.spans[0]?.metrics);
      expect(original.spans[0]?.output).toEqual({
        type: "text",
        value: "captured output",
      });
    });
  });

  describe("given a correction that deletes a parent span", () => {
    /** @scenario "Deleting a span drops its descendants too" */
    it("drops the whole subtree and keeps unrelated siblings", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([
          span({ span_id: "root" }),
          span({ span_id: "tool", parent_id: "root" }),
          span({ span_id: "tool-child", parent_id: "tool" }),
          span({ span_id: "tool-grandchild", parent_id: "tool-child" }),
          span({ span_id: "sibling", parent_id: "root" }),
        ]),
        patch: patchOf({ deletedSpanIds: ["tool"] }),
      });

      expect(corrected.spans.map((s) => s.span_id)).toEqual(["root", "sibling"]);
    });

    it("expands a deletion over a cyclic parent chain without hanging", () => {
      const deleted = expandDeletedSpanIds({
        links: [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "a" },
        ],
        deletedSpanIds: ["a"],
      });

      expect([...deleted].sort()).toEqual(["a", "b"]);
    });
  });

  describe("given a correction to the trace output", () => {
    /** @scenario "A trace output correction replaces the trace output" */
    it("replaces the trace output", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([span({ span_id: "span-1" })]),
        patch: patchOf({ trace: { output: { value: "the right answer" } } }),
      });

      expect(corrected.output).toEqual({ value: "the right answer" });
      expect(corrected.input).toEqual({ value: "captured input" });
    });
  });

  describe("given a correction that clears a span error", () => {
    /** @scenario "Clearing a span error removes the error" */
    it("removes the error from the read span", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([
          span({
            span_id: "span-1",
            error: {
              has_error: true,
              message: "boom",
              stacktrace: ["at boom"],
            },
          }),
        ]),
        patch: patchOf({ spans: [{ spanId: "span-1", error: null }] }),
      });

      expect(corrected.spans[0]?.error).toBeNull();
    });
  });

  describe("given a correction naming spans this trace does not have", () => {
    /** @scenario "Deleted span ids that are not in the trace are ignored" */
    it("returns every captured span", () => {
      const original = trace([span({ span_id: "span-1" }), span({ span_id: "span-2" })]);

      const corrected = applyOverlayToTrace({
        trace: original,
        patch: patchOf({ deletedSpanIds: ["span-from-another-trace"] }),
      });

      expect(corrected.spans.map((s) => s.span_id)).toEqual(["span-1", "span-2"]);
    });
  });

  describe("given a correction with nothing to apply here", () => {
    /** @scenario "A correction with nothing to apply returns the trace untouched" */
    it("returns the very same trace", () => {
      const original = trace([span({ span_id: "span-1" })]);

      expect(
        applyOverlayToTrace({
          trace: original,
          patch: patchOf({
            spans: [{ spanId: "span-from-another-trace", name: "renamed" }],
          }),
        }),
      ).toBe(original);

      expect(applyOverlayToTrace({ trace: original, patch: null })).toBe(original);

      expect(applyOverlayToTrace({ trace: original, patch: patchOf({}) })).toBe(original);
    });
  });

  describe("given a correction bound for a dataset", () => {
    /** @scenario "A corrected span still fits the dataset span shape" */
    it("produces spans that satisfy the dataset span shape", () => {
      const corrected = applyOverlayToTrace({
        trace: trace([
          span({
            span_id: "span-1",
            type: "llm",
            input: { type: "text", value: "captured" },
            params: { temperature: 0.1 },
          }),
        ]),
        patch: patchOf({
          spans: [
            {
              spanId: "span-1",
              name: "cleaned up",
              input: { type: "chat_messages", value: [{ role: "user" }] },
              output: { type: "text", value: "corrected" },
              params: { temperature: 0.2 },
            },
          ],
        }),
      });

      for (const corrected_span of corrected.spans) {
        const {
          trace_id: _traceId,
          timestamps: _timestamps,
          metrics: _metrics,
          ...datasetShaped
        } = corrected_span;
        const parsed = datasetSpanSchema.safeParse({
          ...datasetShaped,
          params: corrected_span.params ?? {},
        });
        expect(parsed.success).toBe(true);
      }
    });
  });
});

describe("applying a correction to the drawer views", () => {
  describe("given a correction that renames and deletes spans", () => {
    it("renames and drops nodes in the span tree", () => {
      const nodes = [
        { spanId: "root", parentSpanId: null },
        { spanId: "tool", parentSpanId: "root" },
        { spanId: "tool-child", parentSpanId: "tool" },
      ].map((node) => ({
        ...node,
        name: "captured",
        type: "span",
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        status: "ok" as const,
        model: null,
      }));

      const corrected = applyOverlayToSpanTreeNodes({
        nodes,
        patch: patchOf({
          spans: [{ spanId: "root", name: "renamed", type: "agent" }],
          deletedSpanIds: ["tool"],
        }),
      });

      expect(corrected.map((node) => node.spanId)).toEqual(["root"]);
      expect(corrected[0]?.name).toBe("renamed");
      expect(corrected[0]?.type).toBe("agent");
    });

    it("renders the corrected values on the span detail", () => {
      const corrected = applyOverlayToSpanDetail({
        detail: {
          spanId: "span-1",
          parentSpanId: null,
          name: "captured",
          type: "span",
          startTimeMs: 0,
          endTimeMs: 1,
          durationMs: 1,
          status: "error",
          input: "captured input",
          output: "captured output",
          error: { message: "boom", stacktrace: [] },
          params: { temperature: 0.1 },
          events: [],
        },
        patch: patchOf({
          spans: [
            {
              spanId: "span-1",
              name: "renamed",
              error: null,
              output: { type: "text", value: "corrected output" },
            },
          ],
        }),
      });

      expect(corrected.name).toBe("renamed");
      expect(corrected.error).toBeNull();
      expect(corrected.output).toBe("corrected output");
      expect(corrected.input).toBe("captured input");
    });

    it("shows the corrected trace output on the header", () => {
      const corrected = applyOverlayToTraceHeader({
        header: {
          traceId: "trace-1",
          output: "captured output",
        } as Parameters<typeof applyOverlayToTraceHeader>[0]["header"],
        patch: patchOf({ trace: { output: { value: "corrected output" } } }),
      });

      expect(corrected.output).toBe("corrected output");
    });

    /** @scenario "The header counts the spans the corrected trace has" */
    it("counts only the spans the corrected trace still has", () => {
      const spans = [
        { spanId: "root", parentSpanId: null },
        { spanId: "tool", parentSpanId: "root" },
        { spanId: "tool-child", parentSpanId: "tool" },
      ];
      const header = {
        traceId: "trace-1",
        spanCount: 3,
      } as Parameters<typeof applyOverlayToTraceHeader>[0]["header"];

      const corrected = applyOverlayToTraceHeader({
        header,
        patch: patchOf({ deletedSpanIds: ["tool"] }),
        spans,
      });
      expect(corrected.spanCount).toBe(1);

      // The captured trace is counted as it was captured.
      expect(applyOverlayToTraceHeader({ header, patch: null, spans }).spanCount).toBe(3);

      // An id the correction lists that the trace does not have removes nothing
      // from the count.
      expect(
        applyOverlayToTraceHeader({
          header,
          patch: patchOf({ deletedSpanIds: ["never-ingested"] }),
          spans,
        }).spanCount,
      ).toBe(3);
    });
  });

  describe("given a correction that changes the trace metadata", () => {
    const captured = () =>
      trace([], {
        metadata: {
          environment: "staging",
          reviewer: "unassigned",
          thread_id: "thread-1",
        },
      });

    /** @scenario "A metadata correction replaces the keys it names and leaves the rest" */
    it("replaces the keys it names and leaves the rest as captured", () => {
      const corrected = applyOverlayToTrace({
        trace: captured(),
        patch: patchOf({ trace: { metadata: { environment: "production" } } }),
      });

      expect(corrected.metadata).toEqual({
        environment: "production",
        reviewer: "unassigned",
        thread_id: "thread-1",
      });
    });

    /** @scenario "A metadata correction removes a key by naming it null" */
    it("removes a key the correction names null", () => {
      const corrected = applyOverlayToTrace({
        trace: captured(),
        patch: patchOf({ trace: { metadata: { reviewer: null } } }),
      });

      expect(corrected.metadata).toEqual({
        environment: "staging",
        thread_id: "thread-1",
      });
    });

    /** @scenario "A correction can clear the whole metadata map" */
    it("clears the metadata when the correction names no map at all", () => {
      const corrected = applyOverlayToTrace({
        trace: captured(),
        patch: patchOf({ trace: { metadata: null } }),
      });

      expect(corrected.metadata).toEqual({});
    });

    /** @scenario "Corrected metadata reads on the drawer header" */
    it("reads on the header row the metadata was ingested on", () => {
      const corrected = applyOverlayToTraceHeader({
        header: {
          traceId: "trace-1",
          attributes: {
            "metadata.environment": "staging",
            "metadata.reviewer": "unassigned",
            "langwatch.labels": '["nightly"]',
          },
        } as unknown as Parameters<typeof applyOverlayToTraceHeader>[0]["header"],
        patch: patchOf({
          trace: {
            metadata: {
              environment: "production",
              reviewer: null,
              labels: ["nightly", "reviewed"],
            },
          },
        }),
      });

      expect(corrected.attributes).toEqual({
        "metadata.environment": "production",
        "langwatch.labels": '["nightly","reviewed"]',
      });
    });

    /** @scenario "Corrected metadata reads on the drawer header" */
    it("names the metadata keys the correction changed", () => {
      expect(
        changedTraceMetadataKeys(
          patchOf({
            trace: { metadata: { environment: "production", reviewer: null } },
          }),
        ),
      ).toEqual(["environment", "reviewer"]);
      expect(changedTraceMetadataKeys(patchOf({}))).toEqual([]);
      expect(changedTraceMetadataKeys(null)).toEqual([]);
    });
  });

  describe("when highlighting what changed", () => {
    it("names the fields a correction replaced on one span", () => {
      const patch = patchOf({
        spans: [
          {
            spanId: "span-1",
            name: "renamed",
            output: { type: "text", value: "corrected" },
          },
        ],
        deletedSpanIds: ["span-2"],
      });

      expect(changedSpanFields({ patch, spanId: "span-1" })).toEqual(["name", "output"]);
      expect(changedSpanFields({ patch, spanId: "span-3" })).toEqual([]);
      // Removing a span replaces none of its fields, so it names none.
      expect(changedSpanFields({ patch, spanId: "span-2" })).toEqual([]);
    });
  });
});
