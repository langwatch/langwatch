/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type FieldTypeOption, FieldTypeSelect } from "../FieldTypeSelect";

const OPTIONS: FieldTypeOption[] = [
  { value: "str", label: "Text" },
  { value: "float", label: "Number" },
  { value: "bool", label: "Boolean" },
];

const renderComponent = (
  props: Partial<Parameters<typeof FieldTypeSelect>[0]> = {},
) => {
  const defaultProps = {
    value: "str",
    options: OPTIONS,
    onChange: vi.fn(),
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <FieldTypeSelect {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("FieldTypeSelect", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when editable", () => {
    it("shows the type label next to the icon as a button", () => {
      renderComponent({ value: "float", testId: "type-select" });

      const button = screen.getByTestId("type-select");
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveTextContent("Number");
    });

    it("opens the menu and reports the chosen type", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderComponent({ value: "str", onChange, testId: "type-select" });

      await user.click(screen.getByTestId("type-select"));
      await user.click(screen.getByTestId("field-type-option-bool"));

      expect(onChange).toHaveBeenCalledWith("bool");
    });
  });

  describe("when read-only", () => {
    it("shows the label without a clickable button", () => {
      renderComponent({
        value: "float",
        readOnly: true,
        testId: "type-select",
      });

      const display = screen.getByTestId("type-select");
      expect(display).toHaveTextContent("Number");
      expect(display.tagName).not.toBe("BUTTON");
    });
  });
});
