/**
 * @vitest-environment jsdom
 *
 * Jumping to what a comment is about: the span selected, and the section of the
 * detail holding a field opened and briefly highlighted.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useSectionFocusGlow } from "../../components/TraceDrawer/traceAccordions/useSectionFocusGlow";
import { useDrawerStore } from "../../stores/drawerStore";
import { useFocusSectionStore } from "@langwatch/trace-web";
import { useSpanPulseStore } from "@langwatch/trace-web";
import { useJumpToAnnotationAnchor } from "../useJumpToAnnotationAnchor";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-7";

/**
 * The two halves of a jump wired the way the drawer wires them: something that
 * asks to be taken to a part of the trace, and an accordion stack watching for
 * the request.
 */
function JumpHarness({ anchorPath }: { anchorPath: string | null }) {
  const [openSections, setOpenSections] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const { glow } = useSectionFocusGlow({
    traceId: TRACE_ID,
    sections: ["io", "attributes"],
    openSections,
    setOpenSections,
    containerRef,
  });
  const jump = useJumpToAnnotationAnchor();
  return (
    <div ref={containerRef}>
      <button
        type="button"
        onClick={() =>
          jump({
            traceId: TRACE_ID,
            anchorKind: "field",
            anchorId: SPAN_ID,
            anchorPath,
          })
        }
      >
        Go to the comment
      </button>
      <div data-section="io" data-testid="io-section">
        {openSections.includes("io") ? "open" : "closed"}
      </div>
      {glow ? <span data-testid="section-glow" /> : null}
    </div>
  );
}

beforeEach(() => {
  useDrawerStore.getState().clearSpan();
  useDrawerStore.getState().setViewModeTransient("conversation");
  useFocusSectionStore.getState().clear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("given a span carries a comment about its output", () => {
  describe("when the reader jumps to that comment's field", () => {
    /** @scenario "Jumping to a comment on a field opens the part of the detail holding it" */
    it("opens the section holding the output", async () => {
      render(<JumpHarness anchorPath="output" />);

      fireEvent.click(screen.getByText("Go to the comment"));

      await waitFor(() =>
        expect(screen.getByTestId("io-section")).toHaveTextContent("open"),
      );
    });

    /** @scenario "Jumping to a comment on a field opens the part of the detail holding it" */
    it("highlights it briefly so the reader sees where they landed", async () => {
      render(<JumpHarness anchorPath="output" />);

      fireEvent.click(screen.getByText("Go to the comment"));

      await waitFor(() => expect(screen.getByTestId("section-glow")).toBeInTheDocument());
    });

    it("selects the span the field belongs to and shows the trace view", () => {
      render(<JumpHarness anchorPath="output" />);

      fireEvent.click(screen.getByText("Go to the comment"));

      expect(useDrawerStore.getState().selectedSpanId).toBe(SPAN_ID);
      expect(useDrawerStore.getState().viewMode).toBe("trace");
      expect(useSpanPulseStore.getState().pulsingIds.has(SPAN_ID)).toBe(true);
    });
  });
});
