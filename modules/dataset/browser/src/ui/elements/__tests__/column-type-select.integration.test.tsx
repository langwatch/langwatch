/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ColumnTypeSelect } from "../column-type-select.tsx";

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// Checked through a widened cast, rather than reading `prototype.x` directly
// (which would extract lib.dom's method-typed member as an unbound value) or
// `"x" in prototype` (which TS narrows to `never`, since lib.dom declares
// both as always-present, non-optional methods).
type MaybeElementScrollMethods = { scrollTo?: unknown; scrollIntoView?: unknown };
if (!(Element.prototype as MaybeElementScrollMethods).scrollTo) {
  Element.prototype.scrollTo = function () {};
}
if (!(Element.prototype as MaybeElementScrollMethods).scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

const renderSelect = (props: Partial<React.ComponentProps<typeof ColumnTypeSelect>> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ColumnTypeSelect value="string" onChange={vi.fn()} aria-label="Column 1 type" {...props} />
    </ChakraProvider>,
  );

describe("ColumnTypeSelect", () => {
  afterEach(() => cleanup());

  describe("when a type is selected", () => {
    it("labels the trigger and shows the selected type's friendly label", () => {
      renderSelect({ value: "image" });

      const trigger = screen.getByLabelText("Column 1 type");
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(/^image$/i);
    });
  });

  describe("when the column holds an attachment", () => {
    it("offers a File type", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderSelect({ value: "string", onChange });

      await user.click(screen.getByLabelText("Column 1 type"));
      await user.click(await screen.findByRole("option", { name: /^file$/i }));

      expect(onChange).toHaveBeenCalledWith("file");
    });
  });

  describe("when the user picks a different type", () => {
    it("opens the option list and reports the chosen type by its value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderSelect({ value: "string", onChange });

      await user.click(screen.getByLabelText("Column 1 type"));
      await user.click(await screen.findByRole("option", { name: /number/i }));

      // The label is friendly ("Number") but the reported value is the stored
      // column-type string.
      expect(onChange).toHaveBeenCalledWith("number");
    });
  });
});
