/**
 * @vitest-environment jsdom
 * Two rows sharing a name silently collapse to one entry (later wins);
 * this test holds the form to reporting that collision, unsendable.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type LangWatchQLParametersChange,
  LangWatchQLParametersEditor,
} from "../langwatch-ql-parameters-editor.tsx";

/** Renders the editor open, returning the spy holding every change it emits. */
function renderEditor() {
  const onChange = vi.fn<(change: LangWatchQLParametersChange) => void>();

  render(
    <ChakraProvider value={defaultSystem}>
      <LangWatchQLParametersEditor
        onChange={onChange}
        missingParameters={[]}
        reservedParameters={[]}
      />
    </ChakraProvider>,
  );

  // The form ships collapsed; the rows only exist once it is opened.
  fireEvent.click(screen.getByRole("button", { name: /parameters/i }));

  return { onChange };
}

/** The change the editor emitted most recently. */
function latestChange(
  onChange: ReturnType<typeof renderEditor>["onChange"],
): LangWatchQLParametersChange {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error("the editor emitted no change");
  return call[0];
}

function addRow() {
  fireEvent.click(screen.getByRole("button", { name: /add parameter/i }));
}

/** Fills every name field in row order, then every value field. */
function fillRows(rows: readonly { name: string; value: string }[]) {
  const names = screen.getAllByPlaceholderText(/name/i);
  const values = screen.getAllByPlaceholderText(/value/i);

  rows.forEach((row, index) => {
    const nameField = names[index];
    const valueField = values[index];
    if (!nameField || !valueField) throw new Error(`row ${index} is missing`);
    fireEvent.change(nameField, { target: { value: row.name } });
    fireEvent.change(valueField, { target: { value: row.value } });
  });
}

describe("given the LangWatchQL parameters editor", () => {
  describe("when two rows are given the same name", () => {
    it("refuses to be sendable", () => {
      const { onChange } = renderEditor();

      addRow();
      addRow();
      fillRows([
        { name: "limit", value: "10" },
        { name: "limit", value: "20" },
      ]);

      expect(latestChange(onChange).sendable).toBe(false);
    });

    it("carries only one of the colliding values, which is why it refuses", () => {
      const { onChange } = renderEditor();

      addRow();
      addRow();
      fillRows([
        { name: "limit", value: "10" },
        { name: "limit", value: "20" },
      ]);

      // The collapse itself: two filled rows, one entry. The refusal above is
      // what keeps this from reaching the server unannounced.
      expect(Object.keys(latestChange(onChange).parameters)).toEqual(["limit"]);
    });

    it("names the collision on the rows", () => {
      renderEditor();

      addRow();
      addRow();
      fillRows([
        { name: "limit", value: "10" },
        { name: "limit", value: "20" },
      ]);

      expect(screen.getAllByText("Use this name once.")).toHaveLength(2);
    });
  });

  describe("when the rows are given distinct names", () => {
    it("is sendable and carries both", () => {
      const { onChange } = renderEditor();

      addRow();
      addRow();
      fillRows([
        { name: "limit", value: "10" },
        { name: "offset", value: "20" },
      ]);

      const change = latestChange(onChange);
      expect(change.sendable).toBe(true);
      expect(Object.keys(change.parameters).sort()).toEqual(["limit", "offset"]);
    });
  });
});
