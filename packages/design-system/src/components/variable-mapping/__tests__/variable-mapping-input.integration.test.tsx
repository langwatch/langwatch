// @vitest-environment jsdom
/**
 * A dataset mapping names its column; one naming a column the dataset does not
 * have says so, since nothing is sent for it.
 * @see specs/experiments-v3/mapping-validation.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import type { AvailableSource } from "../types.ts";
import { VariableMappingInput } from "../variable-mapping-input.tsx";

afterEach(cleanup);

const sources: AvailableSource[] = [
  {
    id: "dataset-1",
    name: "Runs",
    type: "dataset",
    fields: [
      { name: "input", type: "str" },
      { name: "environment", type: "str" },
    ],
  },
];

describe("VariableMappingInput", () => {
  describe("given a mapping to a column the dataset has", () => {
    /** @scenario "The mapping names a column the dataset does not have" */
    it("shows the column as mapped", () => {
      renderWithDesignSystem(
        <VariableMappingInput
          availableSources={sources}
          mapping={{ type: "source", sourceId: "dataset-1", path: ["environment"] }}
        />,
      );

      expect(screen.getByText("Runs.environment")).toBeInTheDocument();
      expect(screen.getByTestId("source-mapping-tag")).not.toHaveAttribute("data-missing-column");
    });
  });

  describe("given a mapping to a column the dataset does not have", () => {
    /** @scenario "The mapping names a column the dataset does not have" */
    it("says the column is not in the dataset", () => {
      renderWithDesignSystem(
        <VariableMappingInput
          availableSources={sources}
          mapping={{ type: "source", sourceId: "dataset-1", path: ["region"] }}
        />,
      );

      expect(screen.getByText('"region" is not in the dataset')).toBeInTheDocument();
      expect(screen.getByTestId("source-mapping-tag")).toHaveAttribute(
        "data-missing-column",
        "true",
      );
    });
  });
});
