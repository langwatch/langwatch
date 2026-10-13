/**
 * @vitest-environment jsdom
 * @see specs/variable-mapping.feature
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { type FieldMapping, VariablesSection } from "../src/components/variable-mapping/index.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => {
  cleanup();
});

describe("<VariablesSection/> with mappings shown", () => {
  /** @scenario "A variable is mapped to a source field picked from the list" */
  it("reports the dataset field picked for an input as a source mapping", async () => {
    const reported: [string, FieldMapping | undefined][] = [];
    renderWithDesignSystem(
      <VariablesSection
        variables={[{ identifier: "question", type: "str" }]}
        onChange={() => undefined}
        showMappings
        canAddRemove={false}
        availableSources={[
          {
            id: "dataset_1",
            name: "Customer questions",
            type: "dataset",
            fields: [{ name: "question", type: "str" }],
          },
        ]}
        onMappingChange={(identifier, mapping) => reported.push([identifier, mapping])}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("mapping-input-question"));
    await user.click(await screen.findByTestId("field-option-question"));

    expect(reported).toEqual([
      ["question", { type: "source", sourceId: "dataset_1", path: ["question"] }],
    ]);
  });
});
