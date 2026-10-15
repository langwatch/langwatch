/**
 * @vitest-environment jsdom
 * @see specs/prompts/prompt-editor-outputs.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Output, OutputsSection } from "../outputs-section.tsx";

vi.mock("../../../elements/workflow/code/workflow-code-editor.tsx", () => ({
  WorkflowCodeEditor: ({ code }: { code: string }) => (
    <textarea aria-label="JSON schema" readOnly value={code} />
  ),
}));

const renderSection = (outputs: Output[], onChange = vi.fn()) => {
  renderWithDesignSystem(<OutputsSection outputs={outputs} onChange={onChange} />);
  return { onChange };
};

describe("OutputsSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the prompt has the default single output of type str", () => {
    describe("when I add an output from the section", () => {
      /** @scenario "Adding an output from the section enables structured outputs" */
      it("appends the new output alongside the existing one, named after the outputs", async () => {
        const user = userEvent.setup();
        const { onChange } = renderSection([{ identifier: "output", type: "str" }]);

        await user.click(screen.getByTestId("add-output-button"));
        await user.click(screen.getByRole("menuitem", { name: "Text" }));

        expect(onChange).toHaveBeenCalledWith([
          { identifier: "output", type: "str" },
          { identifier: "output_1", type: "str" },
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

  describe("given an editor that offers JSON schema outputs", () => {
    describe("when I add a JSON Schema output", () => {
      it("adds it with the default schema and opens the schema editor", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithDesignSystem(
          <OutputsSection
            outputs={[{ identifier: "output", type: "str" }]}
            onChange={onChange}
            availableTypes={["str", "json_schema", "dict"]}
          />,
        );

        await user.click(screen.getByTestId("add-output-button"));
        await user.click(screen.getByRole("menuitem", { name: "JSON Schema" }));

        expect(onChange).toHaveBeenCalledWith([
          { identifier: "output", type: "str" },
          {
            identifier: "output_1",
            type: "json_schema",
            json_schema: expect.objectContaining({ type: "object" }),
          },
        ]);
        expect(await screen.findByLabelText("JSON schema")).toBeInTheDocument();
      });
    });
  });

  describe("given the prompt has exactly one output", () => {
    /** @scenario "The last output cannot be removed" */
    it("disables its remove button and leaves the outputs alone", async () => {
      const user = userEvent.setup();
      const { onChange } = renderSection([{ identifier: "output", type: "str" }]);

      const remove = screen.getByTestId("remove-output-output");
      expect(remove).toBeDisabled();
      expect(remove).toHaveAccessibleName("Remove output output");
      await user.click(remove);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("given an output name is being edited", () => {
    /** @scenario "Output names use the same keyboard editing as variable names" */
    it("commits once on Enter and keeps the old name on Escape", async () => {
      const user = userEvent.setup();
      const { onChange } = renderSection([{ identifier: "output", type: "str" }]);

      await user.click(screen.getByTestId("output-name-output"));
      const input = screen.getByTestId("output-name-input-output");
      await user.clear(input);
      await user.type(input, "score{Enter}");
      expect(onChange).toHaveBeenCalledTimes(1);

      await user.click(screen.getByTestId("output-name-output"));
      await user.type(screen.getByTestId("output-name-input-output"), "x{Escape}");
      expect(onChange).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByTestId("output-name-output")).toHaveFocus());
    });
  });
});
