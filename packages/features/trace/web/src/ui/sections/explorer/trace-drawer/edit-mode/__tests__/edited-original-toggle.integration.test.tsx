/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";

const overlayData = vi.hoisted(() => ({
  current: null as {
    traceId: string;
    patch: TraceEditOverlayPatch;
    createdBy: { id: string; name: string | null } | null;
    updatedBy: { id: string; name: string | null } | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
}));

vi.mock("../../../hooks/use-trace-edit-overlay", () => ({
  useTraceEditOverlay: () => ({ data: overlayData.current }),
  useAppliedTraceEditPatch: () => overlayData.current?.patch ?? null,
}));

vi.mock("../../../hooks/use-trace-header", () => ({
  useTraceHeaderCanonical: () => ({ data: undefined }),
}));

vi.mock("../../../hooks/use-spans-full", () => ({
  useSpansFullCanonical: () => ({ data: undefined }),
  applyOverlayToSpansFull: ({ spans }: { spans: unknown[] }) => spans,
}));

import { useDrawerStore, useTraceEditStore } from "../../../../../../index";
import { EditedOriginalToggle } from "../edited-original-toggle";

const patch: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "search the web" }],
  deletedSpanIds: [],
};

function withCorrection(authorName: string | null = "Robin") {
  overlayData.current = {
    traceId: "trace-1",
    patch,
    createdBy: { id: "user-1", name: authorName },
    updatedBy: { id: "user-1", name: authorName },
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-02T10:00:00Z"),
  };
}

function renderToggle() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditedOriginalToggle />
    </ChakraProvider>,
  );
}

describe("EditedOriginalToggle", () => {
  beforeEach(() => {
    overlayData.current = null;
    useTraceEditStore.getState().discard();
    useDrawerStore.getState().setIsEditing(false);
  });

  afterEach(cleanup);

  describe("given a trace with no correction", () => {
    describe("when the header renders", () => {
      /** @scenario "A trace with no correction offers no switch" */
      it("offers nothing to switch between", () => {
        renderToggle();

        expect(screen.queryByText("Edited")).not.toBeInTheDocument();
        expect(screen.queryByText("Original")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a trace with a correction", () => {
    beforeEach(() => withCorrection());

    describe("when the header renders", () => {
      /** @scenario "The corrected trace is what the reader sees by default" */
      it("shows the corrected trace and offers the captured one", () => {
        renderToggle();

        expect(screen.getByText("Edited")).toBeInTheDocument();
        expect(screen.getByText("Original")).toBeInTheDocument();
        expect(useTraceEditStore.getState().overlayView).toBe("edited");
      });

      /** @scenario "The correction names who made it" */
      it("names who corrected it", () => {
        renderToggle();

        expect(screen.getByText("Edited by Robin")).toBeInTheDocument();
      });
    });

    describe("when the reader switches to the captured trace", () => {
      /** @scenario "Switching to the captured trace shows the original values" */
      it("reads the captured trace from then on", () => {
        renderToggle();

        fireEvent.click(screen.getByText("Original"));

        expect(useTraceEditStore.getState().overlayView).toBe("original");
      });
    });

    describe("when the reviewer is editing", () => {
      it("steps out of the way", () => {
        useDrawerStore.getState().setIsEditing(true);

        renderToggle();

        expect(screen.queryByText("Original")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a correction whose author has no name recorded", () => {
    beforeEach(() => withCorrection(null));

    describe("when the header renders", () => {
      /** @scenario "The correction names who made it" */
      it("names nobody rather than crediting a blank", () => {
        renderToggle();

        expect(screen.getByText("Edited")).toBeInTheDocument();
        expect(screen.queryByText(/^Edited by/)).not.toBeInTheDocument();
      });
    });
  });
});
