/**
 * @vitest-environment jsdom
 * @see specs/variables-ui/variables-section.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { VariablesSectionProps } from "@langwatch/prompt-client";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LentVariablesSection } from "../lent-prompt-fields.tsx";

const props = (overrides: Partial<VariablesSectionProps> = {}): VariablesSectionProps => ({
  variables: [
    { identifier: "question", type: "str" },
    { identifier: "context", type: "str" },
  ],
  onChange: vi.fn(),
  onMappingChange: vi.fn(),
  mappings: { question: { type: "source", sourceId: "entry", path: ["input"] } },
  availableSources: [
    { id: "entry", name: "Entry", type: "entry", fields: [{ name: "input", type: "str" }] },
  ],
  renderSourceIcon: () => <span data-testid="source-icon" />,
  ...overrides,
});

describe("LentVariablesSection", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario "Workflow uses the prompt variables editor without changing mappings" */
  it("carries rename, retype and delete through the node callbacks and draws the source icon", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onMappingChange = vi.fn();
    renderWithDesignSystem(<LentVariablesSection {...props({ onChange, onMappingChange })} />);

    expect(screen.getAllByTestId("source-icon").length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("variable-name-question"));
    const input = screen.getByTestId("variable-name-input-question");
    await user.clear(input);
    await user.type(input, "query{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([
      { identifier: "query", type: "str" },
      { identifier: "context", type: "str" },
    ]);
    expect(onMappingChange).toHaveBeenCalledWith("question", undefined);
    expect(onMappingChange).toHaveBeenCalledWith("query", {
      type: "source",
      sourceId: "entry",
      path: ["input"],
    });

    await user.click(screen.getByTestId("variable-type-select-context"));
    await user.click(screen.getByTestId("field-type-option-float"));
    expect(onChange).toHaveBeenLastCalledWith([
      { identifier: "question", type: "str" },
      { identifier: "context", type: "float" },
    ]);

    await user.click(screen.getByTestId("remove-variable-context"));
    expect(onChange).toHaveBeenLastCalledWith([{ identifier: "question", type: "str" }]);
  });

  it("opens a literal value two lines tall when asked", () => {
    renderWithDesignSystem(
      <LentVariablesSection
        {...props({ showMappings: false, valueRows: 2, values: { question: "hi" } })}
      />,
    );
    expect(screen.getByTestId("variable-value-input-question")).toHaveAttribute("rows", "2");
  });
});
