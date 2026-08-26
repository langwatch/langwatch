/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanDetail, TraceHeader } from "@langwatch/trace-contract";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const header = vi.hoisted(() => ({
  current: {
    traceId: "trace-1",
    name: "chat turn",
    output: "the answer is 41",
  } as unknown as TraceHeader,
}));

const spansFull = vi.hoisted(() => ({ current: [] as SpanDetail[] }));

vi.mock("../../../hooks/useTraceHeader", () => ({
  useTraceHeaderCanonical: () => ({ data: header.current }),
}));

vi.mock("../../../hooks/useSpansFull", async () => {
  const actual = await vi.importActual<typeof import("../../../hooks/useSpansFull")>(
    "../../../hooks/useSpansFull",
  );
  return {
    ...actual,
    useSpansFullCanonical: () => ({ data: spansFull.current }),
  };
});

import { TraceEditDiffDialog } from "../TraceEditDiffDialog";

function renderDialog(patch: TraceEditOverlayPatch) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceEditDiffDialog open onClose={vi.fn()} patch={patch} />
    </ChakraProvider>,
  );
}

const capturedSpan = {
  spanId: "span-1",
  parentSpanId: null,
  name: "web_search",
  type: "tool",
  startTimeMs: 0,
  endTimeMs: 1,
  durationMs: 1,
  status: "ok",
  params: {},
  events: [],
} as unknown as SpanDetail;

describe("TraceEditDiffDialog", () => {
  afterEach(() => {
    cleanup();
    spansFull.current = [];
  });

  describe("given a correction that replaces the trace output", () => {
    describe("when the difference is opened", () => {
      /** @scenario "The diff lists the lines the correction added and removed" */
      it("lists the captured line as removed and the corrected line as added", async () => {
        renderDialog({
          version: 1,
          trace: { output: { value: "the answer is 42" } },
          spans: [],
          deletedSpanIds: [],
        });

        expect(
          await screen.findByText(/"output": "the answer is 41"/),
        ).toBeInTheDocument();
        expect(screen.getByText(/"output": "the answer is 42"/)).toBeInTheDocument();
      });

      /** @scenario "The diff lists the lines the correction added and removed" */
      /** @scenario "The difference opens on the part of the trace that changed" */
      it("counts one line added and one removed on the trace tab", async () => {
        renderDialog({
          version: 1,
          trace: { output: { value: "the answer is 42" } },
          spans: [],
          deletedSpanIds: [],
        });

        expect(await screen.findByText("trace +1 -1")).toBeInTheDocument();
        expect(screen.getByText("spans +0 -0")).toBeInTheDocument();
      });
    });
  });

  describe("given a correction that only changes a span", () => {
    describe("when the difference is opened", () => {
      /** @scenario "The difference opens on the part of the trace that changed" */
      it("opens on the span differences rather than on an unchanged trace", async () => {
        spansFull.current = [capturedSpan];

        renderDialog({
          version: 1,
          spans: [{ spanId: "span-1", name: "search the web" }],
          deletedSpanIds: [],
        });

        expect(await screen.findByText(/"name": "search the web"/)).toBeInTheDocument();
        expect(screen.queryByText("No changes")).not.toBeInTheDocument();
      });

      /** @scenario "The difference opens on the part of the trace that changed" */
      it("carries each part's counts on its own tab", async () => {
        spansFull.current = [capturedSpan];

        renderDialog({
          version: 1,
          spans: [{ spanId: "span-1", name: "search the web" }],
          deletedSpanIds: [],
        });

        expect(await screen.findByText("spans +1 -1")).toBeInTheDocument();
        expect(screen.getByText("trace +0 -0")).toBeInTheDocument();
      });
    });
  });

  describe("given a correction that changes nothing about the trace", () => {
    describe("when the difference is opened", () => {
      /** @scenario "The diff says so when nothing differs" */
      it("reports no changes", async () => {
        renderDialog({
          version: 1,
          spans: [{ spanId: "span-1", name: "search the web" }],
          deletedSpanIds: [],
        });

        expect(await screen.findByText("No changes")).toBeInTheDocument();
      });
    });
  });
});
