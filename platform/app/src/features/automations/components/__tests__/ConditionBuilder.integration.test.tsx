/**
 * @vitest-environment jsdom
 *
 * The condition builder is the friendly front-end over the trace query string.
 * These tests pin the two things that matter: an existing query renders as
 * editable rows, and editing a row emits the updated query string (so the
 * builder and the Code editor stay one source of truth). Chakra Select menus
 * don't open reliably in jsdom, so interactions go through the plain inputs.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutomationStore } from "../../state/automationStore";
import { ConditionBuilder } from "../ConditionBuilder";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function Harness({
  initial,
  onChangeSpy,
}: {
  initial: string;
  onChangeSpy?: (q: string) => void;
}) {
  const [query, setQuery] = useState(initial);
  return (
    <ConditionBuilder
      query={query}
      onChange={(q) => {
        onChangeSpy?.(q);
        setQuery(q);
      }}
    />
  );
}

afterEach(cleanup);

describe("ConditionBuilder", () => {
  describe("given an existing structured query", () => {
    it("renders one row per clause with an AND separator between them", () => {
      render(<Harness initial="status:error AND cost:>0.1" />, {
        wrapper: Wrapper,
      });

      // The range clause renders a number input carrying its value.
      expect(screen.getByDisplayValue("0.1")).toBeTruthy();
      // AND separator shows for the second condition.
      expect(screen.getByText("AND")).toBeTruthy();
    });
  });

  describe("when a value is edited", () => {
    it("emits the updated query string", () => {
      const onChangeSpy = vi.fn();
      render(<Harness initial="cost:>0.1" onChangeSpy={onChangeSpy} />, {
        wrapper: Wrapper,
      });

      fireEvent.change(screen.getByDisplayValue("0.1"), {
        target: { value: "0.5" },
      });

      expect(onChangeSpy).toHaveBeenLastCalledWith("cost:>0.5");
    });
  });

  describe("given an empty query", () => {
    /** @scenario "A fresh trace automation starts with one editable condition" */
    it("starts with one empty, editable condition row already there", () => {
      render(<Harness initial="" />, { wrapper: Wrapper });

      // No "Add a condition" click needed — the row is already on screen.
      expect(screen.getByText("Field…")).toBeTruthy();
    });

    it("does not emit a query for the seeded, untouched row", () => {
      const onChangeSpy = vi.fn();
      render(<Harness initial="" onChangeSpy={onChangeSpy} />, {
        wrapper: Wrapper,
      });

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    describe("when a second condition is added", () => {
      it("shows a second field picker joined by AND", async () => {
        const user = userEvent.setup();
        render(<Harness initial="" />, { wrapper: Wrapper });

        await user.click(screen.getByText("Add AND condition"));

        expect(screen.getAllByText("Field…")).toHaveLength(2);
        expect(screen.getByText("AND")).toBeTruthy();
      });
    });
  });

  describe("given a custom-attribute condition from the code editor", () => {
    it("renders a key sub-input alongside the attribute field", () => {
      render(<Harness initial="trace.attribute.user_id:premium" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByDisplayValue("user_id")).toBeTruthy();
      expect(screen.getByDisplayValue("premium")).toBeTruthy();
    });
  });

  describe("when the user edits an existing attribute condition's key", () => {
    it("emits the composed field without touching the value", () => {
      const onChangeSpy = vi.fn();
      render(
        <Harness
          initial="trace.attribute.user_id:premium"
          onChangeSpy={onChangeSpy}
        />,
        { wrapper: Wrapper },
      );

      fireEvent.change(screen.getByDisplayValue("user_id"), {
        target: { value: "plan" },
      });

      expect(onChangeSpy).toHaveBeenLastCalledWith(
        "trace.attribute.plan:premium",
      );
    });
  });

  describe("when a completed attribute key cannot round-trip", () => {
    it("holds the drawer's save gate until the key is fixed", () => {
      render(<Harness initial="trace.attribute.user_id:premium" />, {
        wrapper: Wrapper,
      });
      expect(useAutomationStore.getState().hasInvalidConditionRows).toBe(false);

      // The row stays complete (value untouched) while its key turns into
      // something the query language would re-parse as two clauses — the
      // exact case that would otherwise silently save a wider automation.
      fireEvent.change(screen.getByDisplayValue("user_id"), {
        target: { value: "user id" },
      });
      expect(useAutomationStore.getState().hasInvalidConditionRows).toBe(true);

      fireEvent.change(screen.getByDisplayValue("user id"), {
        target: { value: "user_id" },
      });
      expect(useAutomationStore.getState().hasInvalidConditionRows).toBe(false);
    });
  });
});
