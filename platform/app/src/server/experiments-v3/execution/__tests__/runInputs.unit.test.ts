/**
 * Which run inputs still evaluate the experiment's saved dataset, and so may
 * write their cells back into the workbench state.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { describe, expect, it } from "vitest";
import { type RunInputsBody, runsSavedDataset } from "../types";

describe("runsSavedDataset", () => {
  describe("given run inputs that replace or override the dataset", () => {
    describe("when the run decides whether to write its cells back", () => {
      const overrides: Array<{ name: string; inputs: RunInputsBody }> = [
        { name: "inline rows", inputs: { data: [{ input: "hi" }] } },
        { name: "no rows at all", inputs: { data: [] } },
        { name: "another saved dataset", inputs: { dataset_id: "dataset_1" } },
        { name: "constant parameters", inputs: { parameters: { model: "x" } } },
        {
          name: "parameters beside a row subset",
          inputs: { row_indices: [0], parameters: { model: "x" } },
        },
      ];

      for (const { name, inputs } of overrides) {
        /** @scenario A run given its own rows or parameters is not written back */
        it(`writes nothing back for ${name}`, () => {
          expect(runsSavedDataset(inputs)).toBe(false);
        });
      }
    });
  });

  describe("given run inputs that leave the dataset alone", () => {
    describe("when the run decides whether to write its cells back", () => {
      const saved: Array<{ name: string; inputs?: RunInputsBody }> = [
        { name: "no body at all", inputs: undefined },
        { name: "an empty body", inputs: {} },
        { name: "a row subset", inputs: { row_indices: [0, 2] } },
        { name: "an empty parameter map", inputs: { parameters: {} } },
      ];

      for (const { name, inputs } of saved) {
        it(`writes the cells back for ${name}`, () => {
          expect(runsSavedDataset(inputs)).toBe(true);
        });
      }
    });
  });
});
