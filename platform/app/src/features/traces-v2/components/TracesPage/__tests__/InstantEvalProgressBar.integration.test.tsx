/**
 * @vitest-environment jsdom
 *
 * The determinate bar over the table while an Instant Eval run judges.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("Progress is visible
 * while a run judges").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  InstantEvalProgressBar,
  instantEvalProgressCopy,
  instantEvalProgressPercent,
} from "../InstantEvalProgressBar";

vi.hoisted(() => vi.resetModules());

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given a run with total 10,000, progress 3,200 and 412 matched", () => {
  describe("when the progress bar renders", () => {
    /** @scenario "A determinate bar reads the run's counters" */
    it("reads the counters with a Stop button, at 32 percent", () => {
      const onStop = vi.fn();
      render(
        <InstantEvalProgressBar
          judged={3_200}
          total={10_000}
          matched={412}
          question="the user is annoyed"
          phase="judging"
          onStop={onStop}
        />,
        { wrapper },
      );
      expect(
        screen.getByText("Judging 3,200 / 10,000 · 412 matched"),
      ).toBeInTheDocument();
      expect(instantEvalProgressPercent({ judged: 3_200, total: 10_000 })).toBe(
        32,
      );
      fireEvent.click(screen.getByRole("button", { name: "Stop judging" }));
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A stopped run is read until its numbers hold still" */
    it("says it is stopping, with Stop disabled, once the run was asked to stop", () => {
      const onStop = vi.fn();
      render(
        <InstantEvalProgressBar
          judged={500}
          total={1_354}
          matched={72}
          question="the user is annoyed"
          phase="stopping"
          onStop={onStop}
        />,
        { wrapper },
      );
      expect(
        screen.getByText("Stopping 500 / 1,354 · 72 matched"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Stop judging" }),
      ).toBeDisabled();
      expect(
        instantEvalProgressCopy({
          judged: 920,
          total: 1_354,
          matched: 127,
          phase: "settling",
        }),
      ).toBe("Reading the last verdicts 920 / 1,354 · 127 matched");
    });

    it("says the total is still being counted before the run has one", () => {
      expect(
        instantEvalProgressCopy({ judged: 0, total: null, matched: 0 }),
      ).toBe("Judging 0 / … · 0 matched");
      expect(instantEvalProgressPercent({ judged: 0, total: null })).toBeNull();
    });
  });
});

describe("given interrupted progress reporting", () => {
  describe("when the progress notice renders", () => {
    /** @scenario "An interrupted run shows actionable uncertainty without judging animation" */
    it("shows incomplete last counts and the run ID without a progress animation", () => {
      render(
        <InstantEvalProgressBar
          judged={20}
          total={100}
          matched={4}
          question="annoyed user"
          phase="interrupted"
          runId="run-interrupted"
          canStop={true}
          onStop={vi.fn()}
        />,
        { wrapper },
      );
      expect(
        screen.getByText("Progress reporting was interrupted."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Work may still be running and these counts may be incomplete/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("run-interrupted")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Judging /)).not.toBeInTheDocument();
    });
  });
});

describe("given an unavailable first status read", () => {
  /** @scenario "A failed status read marks stale counts until a successful read" */
  it("shows unavailable status without inventing initial counts", () => {
    render(
      <InstantEvalProgressBar
        judged={0}
        total={null}
        matched={0}
        question="annoyed user"
        phase="unavailable"
        runId="run-unavailable"
        hasReportedCounts={false}
        canStop={false}
        onStop={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("Run status unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/^Last reported:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
