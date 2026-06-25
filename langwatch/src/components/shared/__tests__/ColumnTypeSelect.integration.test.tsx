/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnTypeSelect } from "../ColumnTypeSelect";

const renderSelect = (
  props: Partial<React.ComponentProps<typeof ColumnTypeSelect>> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ColumnTypeSelect
        value="string"
        onChange={vi.fn()}
        aria-label="Column 1 type"
        {...props}
      />
    </ChakraProvider>,
  );

describe("ColumnTypeSelect", () => {
  afterEach(() => cleanup());

  describe("when a type is selected", () => {
    it("labels the trigger and shows the selected type's friendly label", () => {
      renderSelect({ value: "image" });

      const trigger = screen.getByLabelText("Column 1 type");
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(/image \(url\)/i);
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
