import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FieldEditor,
  FieldEditorRemove,
  FieldEditorRow,
} from "../../src/components/forms/field-editor.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

function Pair({ width }: { width: number }) {
  return (
    <div style={{ width }}>
      <FieldEditor label="Variables" empty={false} emptyMessage="none">
        <FieldEditorRow
          data-testid="variables-row"
          typeControl={<button type="button">Text</button>}
          nameControl={<span>input</span>}
          value={<span>Entry.input</span>}
          valueLabel="Mapping"
          separator="="
          removeAction={
            <FieldEditorRemove label="Remove" tooltip="Remove" onClick={() => undefined} />
          }
        />
      </FieldEditor>
      <FieldEditor label="Outputs" empty={false} emptyMessage="none">
        <FieldEditorRow
          data-testid="outputs-row"
          typeControl={<button type="button">Text</button>}
          nameControl={<span>output</span>}
          removeAction={
            <FieldEditorRemove label="Remove output" tooltip="Remove" onClick={() => undefined} />
          }
        />
      </FieldEditor>
    </div>
  );
}

const left = (row: HTMLElement, index: number) =>
  Math.round((row.children[index] as HTMLElement).getBoundingClientRect().left);

describe("FieldEditor geometry", () => {
  /** @scenario "Field editor sections share aligned columns" */
  it("lines type, name and remove up between the two sections", () => {
    renderWithDesignSystem(<Pair width={640} />);
    const variables = screen.getByTestId("variables-row");
    const outputs = screen.getByTestId("outputs-row");
    for (const index of [0, 1, 4]) expect(left(variables, index)).toBe(left(outputs, index));
  });

  /** @scenario "A field row reads inline, the value taking the rest of the width" */
  it("puts the separator right after the name and stretches the value to remove", () => {
    renderWithDesignSystem(<Pair width={640} />);
    const row = screen.getByTestId("variables-row");
    const box = (index: number) => (row.children[index] as HTMLElement).getBoundingClientRect();
    const nameText = screen.getByText("input").getBoundingClientRect();

    expect(box(2).left - nameText.right).toBeLessThanOrEqual(12);
    expect(box(4).left - box(3).right).toBeLessThanOrEqual(8);
    expect(box(3).width).toBeGreaterThan(320);

    const heading = getComputedStyle(screen.getByText("Variables"));
    expect(heading.fontWeight).toBe("700");
    expect(heading.textTransform).toBe("uppercase");
    expect(heading.letterSpacing).toBe("normal");
  });

  /** @scenario "Field editor rows fit a narrow drawer" */
  it("moves the value under the name and does not scroll sideways", () => {
    renderWithDesignSystem(<Pair width={272} />);
    const row = screen.getByTestId("variables-row");
    const name = row.children[1] as HTMLElement;
    const value = row.children[3] as HTMLElement;
    expect(value.getBoundingClientRect().top).toBeGreaterThan(name.getBoundingClientRect().top);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
