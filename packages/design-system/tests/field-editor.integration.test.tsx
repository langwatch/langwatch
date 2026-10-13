// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FieldEditor,
  FieldEditorName,
  FieldEditorRemove,
  FieldEditorRow,
} from "../src/components/forms/field-editor.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function Harness({
  id = "input",
  onCommit = () => undefined,
  onCancel = () => undefined,
}: {
  id?: string;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(id);
  return (
    <FieldEditorRow
      typeControl={<button type="button">Text</button>}
      nameControl={
        <FieldEditorName
          value={id}
          editing={editing}
          draft={draft}
          ariaLabel={`Variable name ${id}`}
          onStartEdit={() => setEditing(true)}
          onDraftChange={setDraft}
          onCommit={() => {
            onCommit();
            setEditing(false);
          }}
          onCancel={() => {
            onCancel();
            setEditing(false);
          }}
          displayTestId="name"
          inputTestId="name-input"
        />
      }
      info={<span data-testid="info">i</span>}
      removeAction={
        <FieldEditorRemove label="Remove input" tooltip="Remove" onClick={() => undefined} />
      }
    />
  );
}

describe("FieldEditor", () => {
  describe("given a Variables and an Outputs row", () => {
    /** @scenario "Field editor sections share aligned columns" */
    it("places the type, name and remove controls in the same grid areas", () => {
      renderWithDesignSystem(
        <>
          <FieldEditor label="Variables" empty={false} emptyMessage="none">
            <FieldEditorRow
              data-testid="variables-row"
              typeControl={<button type="button">Text</button>}
              nameControl={<span>input</span>}
              value={<span>mapping</span>}
              removeAction={<button type="button">x</button>}
            />
          </FieldEditor>
          <FieldEditor label="Outputs" empty={false} emptyMessage="none">
            <FieldEditorRow
              data-testid="outputs-row"
              typeControl={<button type="button">Text</button>}
              nameControl={<span>output</span>}
              removeAction={<button type="button">x</button>}
            />
          </FieldEditor>
        </>,
      );

      const variables = screen.getByTestId("variables-row");
      const outputs = screen.getByTestId("outputs-row");
      expect(getComputedStyle(variables).gridTemplateAreas).toBe(
        getComputedStyle(outputs).gridTemplateAreas,
      );
      expect(outputs.children).toHaveLength(5);
      expect(outputs.children[3]).toHaveTextContent("");
    });
  });
  describe("given an editable name", () => {
    /** @scenario "A name can be edited entirely with the keyboard" */
    it("commits once on Enter and cancels once on Escape", async () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      renderWithDesignSystem(<Harness onCommit={onCommit} onCancel={onCancel} />);

      fireEvent.click(screen.getByTestId("name"));
      const input = screen.getByTestId("name-input");
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("name"));
      fireEvent.keyDown(screen.getByTestId("name-input"), { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByTestId("name")).toHaveFocus());
    });
  });
  describe("given a very long name with an information icon", () => {
    /** @scenario "Long names keep their adjacent information reachable" */
    it("names the button in full and keeps the icon in the same group", () => {
      const long = "an_extremely_long_unbroken_variable_name_for_the_grid";
      renderWithDesignSystem(<Harness id={long} />);

      const name = screen.getByRole("button", { name: `Variable name ${long}` });
      expect(name).toHaveAttribute("title", long);
      expect(name.parentElement).toContainElement(screen.getByTestId("info"));
    });
  });
  describe("given an empty section", () => {
    /** @scenario "Field editor stories render in light and dark" */
    it("shows the heading and the empty message", () => {
      renderWithDesignSystem(
        <FieldEditor label="Outputs" empty emptyMessage="No outputs defined" />,
      );
      expect(screen.getByText("Outputs")).toBeInTheDocument();
      expect(screen.getByText("No outputs defined")).toBeInTheDocument();
    });
  });
});
