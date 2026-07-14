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
      render(
        <Harness initial="cost:>0.1" onChangeSpy={onChangeSpy} />,
        { wrapper: Wrapper },
      );

      fireEvent.change(screen.getByDisplayValue("0.1"), {
        target: { value: "0.5" },
      });

      expect(onChangeSpy).toHaveBeenLastCalledWith("cost:>0.5");
    });
  });

  describe("when a condition is added to an empty builder", () => {
    it("shows a fresh field picker", async () => {
      const user = userEvent.setup();
      render(<Harness initial="" />, { wrapper: Wrapper });

      await user.click(screen.getByText("Add a condition"));

      expect(screen.getByText("Field…")).toBeTruthy();
    });
  });
});
