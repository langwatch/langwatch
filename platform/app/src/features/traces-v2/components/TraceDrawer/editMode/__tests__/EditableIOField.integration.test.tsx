/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableIOField } from "../EditableIOField";

const CAPTURED_JSON = '{"answer":"42","source":"almanac"}';

function renderField({
  captured = CAPTURED_JSON,
  draft,
  onChange = vi.fn(),
  onReset = vi.fn(),
}: {
  captured?: string | null;
  draft?: string;
  onChange?: (text: string) => void;
  onReset?: () => void;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditableIOField
        label="Output"
        captured={captured}
        draft={draft}
        onChange={onChange}
        onReset={onReset}
      />
    </ChakraProvider>,
  );
}

describe("EditableIOField", () => {
  afterEach(cleanup);

  describe("given a captured value that holds JSON", () => {
    describe("when the editor opens", () => {
      /** @scenario "A captured JSON value opens as readable JSON" */
      it("formats the value across lines", () => {
        const { getByLabelText } = renderField();

        const editor = getByLabelText("Edit output") as HTMLTextAreaElement;
        expect(editor.value).toBe(JSON.stringify(JSON.parse(CAPTURED_JSON), null, 2));
        expect(editor.value.split("\n").length).toBeGreaterThan(1);
      });

      it("offers no reset until the value is touched", () => {
        const { queryByRole } = renderField();

        expect(queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
      });
    });

    describe("when the reviewer types something that is not JSON", () => {
      /** @scenario "Text that is not valid JSON is accepted with a warning" */
      it("warns that the value will be saved as plain text", () => {
        const { getByText } = renderField({ draft: "the answer is 42" });

        expect(
          getByText("Not valid JSON. It will be saved as plain text."),
        ).toBeInTheDocument();
      });

      /** @scenario "Text that is not valid JSON is accepted with a warning" */
      it("leaves the editor usable", () => {
        const onChange = vi.fn();
        const { getByLabelText } = renderField({
          draft: "the answer is 42",
          onChange,
        });

        const editor = getByLabelText("Edit output");
        expect(editor).not.toBeDisabled();
        fireEvent.change(editor, { target: { value: "still prose" } });
        expect(onChange).toHaveBeenCalledWith("still prose");
      });
    });

    describe("when the reviewer types valid JSON", () => {
      it("shows no warning", () => {
        const { queryByText } = renderField({ draft: '{"answer":"43"}' });

        expect(
          queryByText("Not valid JSON. It will be saved as plain text."),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the value has been replaced", () => {
      /** @scenario "Resetting a field returns the captured value" */
      it("resets back to the captured value", () => {
        const onReset = vi.fn();
        const { getByRole, rerender, getByLabelText } = renderField({
          draft: "replaced",
          onReset,
        });

        fireEvent.click(getByRole("button", { name: /reset/i }));
        expect(onReset).toHaveBeenCalled();

        rerender(
          <ChakraProvider value={defaultSystem}>
            <EditableIOField
              label="Output"
              captured={CAPTURED_JSON}
              draft={undefined}
              onChange={vi.fn()}
              onReset={onReset}
            />
          </ChakraProvider>,
        );
        expect((getByLabelText("Edit output") as HTMLTextAreaElement).value).toBe(
          JSON.stringify(JSON.parse(CAPTURED_JSON), null, 2),
        );
      });
    });
  });

  describe("given a captured value larger than the drawer renders", () => {
    describe("when the editor would open", () => {
      /** @scenario "A value too large to edit inline says so" */
      it("refuses to edit it and explains why", () => {
        const { getByText, queryByLabelText } = renderField({
          captured: "x".repeat(100_001),
        });

        expect(getByText("This field is too large to edit here")).toBeInTheDocument();
        expect(queryByLabelText("Edit output")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a captured value that was never JSON", () => {
    describe("when the reviewer rewrites it", () => {
      it("does not warn about JSON", () => {
        const { queryByText } = renderField({
          captured: "the answer is 42",
          draft: "the answer is 43",
        });

        expect(
          queryByText("Not valid JSON. It will be saved as plain text."),
        ).not.toBeInTheDocument();
      });
    });
  });
});
