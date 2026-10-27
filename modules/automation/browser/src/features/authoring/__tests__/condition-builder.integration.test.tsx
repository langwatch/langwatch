/**
 * @vitest-environment jsdom
 * Condition builder tests: verify rendering and editing updates; uses plain inputs
 * (Chakra Select menus unreliable in jsdom).
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConditionBuilder } from "../ui/blocks/condition-builder.tsx";

function Harness({
  initial,
  onChangeSpy,
  onInvalidRowsChange,
}: {
  initial: string;
  onChangeSpy?: (q: string) => void;
  onInvalidRowsChange?: (hasInvalidRows: boolean) => void;
}) {
  const [query, setQuery] = useState(initial);
  return (
    <ConditionBuilder
      query={query}
      onChange={(q) => {
        onChangeSpy?.(q);
        setQuery(q);
      }}
      onInvalidRowsChange={onInvalidRowsChange}
    />
  );
}

afterEach(cleanup);

describe("ConditionBuilder", () => {
  describe("given an existing structured query", () => {
    it("renders one row per clause with an AND separator between them", () => {
      renderWithDesignSystem(<Harness initial="status:error AND cost:>0.1" />);

      // The range clause renders a number input carrying its value.
      expect(screen.getByDisplayValue("0.1")).toBeTruthy();
      // AND separator shows for the second condition.
      expect(screen.getByText("AND")).toBeTruthy();
    });
  });

  describe("when a value is edited", () => {
    it("emits the updated query string", () => {
      const onChangeSpy = vi.fn();
      renderWithDesignSystem(<Harness initial="cost:>0.1" onChangeSpy={onChangeSpy} />);

      fireEvent.change(screen.getByDisplayValue("0.1"), {
        target: { value: "0.5" },
      });

      expect(onChangeSpy).toHaveBeenLastCalledWith("cost:>0.5");
    });
  });

  describe("given an empty query", () => {
    /** @scenario "A fresh trace automation starts with one editable condition" */
    it("starts with one empty, editable condition row already there", () => {
      renderWithDesignSystem(<Harness initial="" />);

      expect(screen.getByText("Field…")).toBeTruthy();
    });

    it("does not emit a query for the seeded, untouched row", () => {
      const onChangeSpy = vi.fn();
      renderWithDesignSystem(<Harness initial="" onChangeSpy={onChangeSpy} />);

      expect(onChangeSpy).not.toHaveBeenCalled();
    });

    describe("when a second condition is added", () => {
      it("shows a second field picker joined by AND", async () => {
        const user = userEvent.setup();
        renderWithDesignSystem(<Harness initial="" />);

        await user.click(screen.getByText("Add AND condition"));

        expect(screen.getAllByText("Field…")).toHaveLength(2);
        expect(screen.getByText("AND")).toBeTruthy();
      });
    });
  });

  describe("given a custom-attribute condition from the code editor", () => {
    it("renders a key sub-input alongside the attribute field", () => {
      renderWithDesignSystem(<Harness initial="trace.attribute.user_id:premium" />);

      expect(screen.getByDisplayValue("user_id")).toBeTruthy();
      expect(screen.getByDisplayValue("premium")).toBeTruthy();
    });
  });

  describe("when the user edits an existing attribute condition's key", () => {
    it("emits the composed field without touching the value", () => {
      const onChangeSpy = vi.fn();
      renderWithDesignSystem(
        <Harness initial="trace.attribute.user_id:premium" onChangeSpy={onChangeSpy} />,
      );

      fireEvent.change(screen.getByDisplayValue("user_id"), { target: { value: "plan" } });

      expect(onChangeSpy).toHaveBeenLastCalledWith("trace.attribute.plan:premium");
    });
  });

  describe("when a completed attribute key cannot round-trip", () => {
    it("reports invalid rows until the key is fixed", () => {
      const onInvalidRowsChange = vi.fn();
      renderWithDesignSystem(
        <Harness
          initial="trace.attribute.user_id:premium"
          onInvalidRowsChange={onInvalidRowsChange}
        />,
      );
      expect(onInvalidRowsChange).toHaveBeenLastCalledWith(false);

      // The row stays complete while its key would re-parse as two clauses:
      // the case that would otherwise silently save a wider automation.
      fireEvent.change(screen.getByDisplayValue("user_id"), { target: { value: "user id" } });
      expect(onInvalidRowsChange).toHaveBeenLastCalledWith(true);

      fireEvent.change(screen.getByDisplayValue("user id"), { target: { value: "user_id" } });
      expect(onInvalidRowsChange).toHaveBeenLastCalledWith(false);
    });
  });
});
