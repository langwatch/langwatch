/**
 * @vitest-environment jsdom
 *
 * What the time-window fields commit, and what they refuse to commit.
 *
 * Driven at the component rather than through the workbench because the thing
 * under test is the moment an override is raised: the workbench only makes a
 * window observable once the member presses Run, by which point the half-typed
 * states this suite is about are long gone.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LangWatchQLTimeWindowEditor } from "../components/LangWatchQLTimeWindowEditor";

const WINDOW = {
  start: Date.UTC(2026, 1, 20, 0, 0, 0),
  end: Date.UTC(2026, 1, 27, 0, 0, 0),
};

/**
 * The editor with its window held still.
 *
 * `value` never moves in reply to `onOverride`, which is deliberate: the fields
 * then keep showing what was typed, so each case can assert what was committed
 * and what is on screen as two separate facts.
 */
function renderEditor() {
  const onOverride = vi.fn();
  const onSendableChange = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <LangWatchQLTimeWindowEditor
        value={WINDOW}
        overridden={false}
        onOverride={onOverride}
        onFollowPage={vi.fn()}
        onSendableChange={onSendableChange}
      />
    </ChakraProvider>,
  );
  return {
    onOverride,
    onSendableChange,
    start: screen.getByLabelText("dashboard_context_period_start"),
  };
}

/** What the member typing into a field looks like to the component. */
function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

const INVALID_COPY = "Enter a date and time, like 2026-02-20 12:00:00.";

describe("given the fields that carry the window a query reports over", () => {
  describe("when a typed instant has a part outside its range", () => {
    it("refuses the date rather than committing the month it rolls over into", () => {
      const { onOverride, start } = renderEditor();

      // `Date.UTC(2026, 12, 45)` is a real instant — the 14th of February 2027
      // — so a shape-only check accepts this and moves the member a year
      // forward without a word.
      type(start, "2026-13-45");

      expect(onOverride).not.toHaveBeenCalled();
      expect(screen.getByText(INVALID_COPY)).toBeInTheDocument();
    });

    it("refuses an impossible day of a month that does exist", () => {
      const { onOverride, start } = renderEditor();

      type(start, "2026-02-30 12:00:00");

      expect(onOverride).not.toHaveBeenCalled();
      expect(screen.getByText(INVALID_COPY)).toBeInTheDocument();
    });

    it("refuses an out-of-range hour on a date that is itself real", () => {
      const { onOverride, start } = renderEditor();

      type(start, "2026-02-24 99:00:00");

      expect(onOverride).not.toHaveBeenCalled();
      expect(screen.getByText(INVALID_COPY)).toBeInTheDocument();
    });
  });

  describe("when a date and time is still being typed", () => {
    it("commits nothing while the time is incomplete", () => {
      const { onOverride, start } = renderEditor();

      for (const partial of [
        "2026-02-24 0",
        "2026-02-24 09",
        "2026-02-24 09:",
        "2026-02-24 09:0",
      ]) {
        type(start, partial);
      }

      expect(onOverride).not.toHaveBeenCalled();
    });

    // The sharp one, and the reason the shape check was not enough on its own:
    // this is a *complete* shape, so it parses — and it parses to ten o'clock,
    // an hour the member is halfway through spelling as nine sixty-something.
    // Committing here runs the query against an instant that was never on
    // screen.
    it("commits nothing for a minute that has rolled into the next hour", () => {
      const { onOverride, start } = renderEditor();

      type(start, "2026-02-24 09:60");

      expect(onOverride).not.toHaveBeenCalled();
      expect(screen.getByText(INVALID_COPY)).toBeInTheDocument();
    });

    it("keeps showing what was typed, so the field stays the member's to finish", () => {
      const { start } = renderEditor();

      type(start, "2026-02-24 09");

      expect(start).toHaveValue("2026-02-24 09");
    });
  });

  describe("when the instant is complete", () => {
    it("commits exactly the instant on screen", () => {
      const { onOverride, start } = renderEditor();

      type(start, "2026-02-24 09:00:00");

      expect(onOverride).toHaveBeenCalledWith({
        start: Date.UTC(2026, 1, 24, 9, 0, 0),
        end: WINDOW.end,
      });
      expect(screen.queryByText(INVALID_COPY)).toBeNull();
    });

    // Accepted rather than overlooked: a date on its own is a shape a member
    // may legitimately mean, and it commits the midnight the field spells back,
    // so the window that runs is the window being read.
    it("accepts a date on its own as the midnight it spells back", () => {
      const { onOverride, start } = renderEditor();

      type(start, "2026-02-24");

      expect(onOverride).toHaveBeenCalledWith({
        start: Date.UTC(2026, 1, 24, 0, 0, 0),
        end: WINDOW.end,
      });
    });
  });

  // The half of the contract that keeps a refused edit from executing: while
  // the visible text does not name a runnable window, the last committed one is
  // stale against what is on screen, and the caller is told to hold Run rather
  // than run a window the member is no longer looking at.
  describe("when the visible text does not name a runnable window", () => {
    it("reports unsendable while a field is invalid, and sendable once it parses again", () => {
      const { onSendableChange, start } = renderEditor();

      type(start, "2026-02-30 12:00:00");
      expect(onSendableChange).toHaveBeenLastCalledWith(false);

      type(start, "2026-02-24 12:00:00");
      expect(onSendableChange).toHaveBeenLastCalledWith(true);
    });

    it("refuses an inverted window, saying which way round it has to be", () => {
      const { onOverride, onSendableChange, start } = renderEditor();

      // After WINDOW.end, so both fields parse and only the order is wrong.
      type(start, "2026-03-01 00:00:00");

      expect(onOverride).not.toHaveBeenCalled();
      expect(onSendableChange).toHaveBeenLastCalledWith(false);
      expect(
        screen.getByText("The start must be before the end."),
      ).toBeInTheDocument();
    });
  });
});
