/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const header = vi.hoisted(() => ({
  current: {
    traceId: "trace-1",
    name: "chat turn",
    output: "the answer is 41",
  } as unknown as TraceHeader,
}));

vi.mock("../../../hooks/useTraceHeader", () => ({
  useTraceHeaderCanonical: () => ({ data: header.current }),
}));

vi.mock("../../../hooks/useSpansFull", async () => {
  const actual = await vi.importActual<
    typeof import("../../../hooks/useSpansFull")
  >("../../../hooks/useSpansFull");
  return {
    ...actual,
    useSpansFullCanonical: () => ({ data: [] }),
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

describe("TraceEditDiffDialog", () => {
  afterEach(cleanup);

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
        expect(
          screen.getByText(/"output": "the answer is 42"/),
        ).toBeInTheDocument();
      });

      /** @scenario "The diff lists the lines the correction added and removed" */
      it("counts one line added and one removed", async () => {
        renderDialog({
          version: 1,
          trace: { output: { value: "the answer is 42" } },
          spans: [],
          deletedSpanIds: [],
        });

        expect(await screen.findByText("+1")).toBeInTheDocument();
        expect(screen.getByText("-1")).toBeInTheDocument();
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
