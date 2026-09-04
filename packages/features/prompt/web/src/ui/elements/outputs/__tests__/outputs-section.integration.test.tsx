/**
 * @vitest-environment jsdom
 *
 * The Outputs section lets a user add, rename and retype an output directly
 * from the prompt editor without opening the model-selector popover.
 *
 * @see specs/prompts/prompt-editor-outputs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Output, OutputsSection } from "../outputs-section";

const renderSection = (outputs: Output[], onChange = vi.fn()) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <OutputsSection outputs={outputs} onChange={onChange} />
    </ChakraProvider>,
  );
  return { onChange };
};

describe("OutputsSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the prompt has the default single output of type str", () => {
    describe("when I add an output from the section", () => {
      /** @scenario "Adding an output from the section enables structured outputs" */
      it("appends the new output alongside the existing one", async () => {
        const user = userEvent.setup();
        const { onChange } = renderSection([{ identifier: "output", type: "str" }]);

        await user.click(screen.getByTestId("add-output-button"));
        await user.click(screen.getByRole("menuitem", { name: "Text" }));

        expect(onChange).toHaveBeenCalledWith([
          { identifier: "output", type: "str" },
          expect.objectContaining({ type: "str" }),
        ]);
      });
    });
  });

  describe("given the prompt has an output named output of type str", () => {
    describe("when I rename it and change its type to float", () => {
      /** @scenario "Renaming and retyping an output from the section" */
      it("reports both the rename and the retype through onChange", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderSection([{ identifier: "output", type: "str" }], onChange);

        await user.click(screen.getByTestId("output-name-output"));
        const input = screen.getByTestId("output-name-input-output");
        await user.clear(input);
        await user.type(input, "score{Enter}");

        expect(onChange).toHaveBeenCalledWith([{ identifier: "score", type: "str" }]);

        await user.click(screen.getByTestId("output-type-select-output"));
        await user.click(screen.getByTestId("field-type-option-float"));

        expect(onChange).toHaveBeenLastCalledWith([{ identifier: "output", type: "float" }]);
      });
    });
  });
});
