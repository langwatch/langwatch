import { describe, expect, it } from "vitest";

import {
  outputsNamedAsOutputs,
  selectedScenarioOutput,
  storedScenarioOutput,
} from "../scenario-output-field.ts";

const outputs = [{ identifier: "answer" }, { identifier: "score" }];

describe("selectedScenarioOutput", () => {
  it("uses the first output when none was chosen", () => {
    expect(selectedScenarioOutput({ outputField: void 0, outputs })).toBe("answer");
  });

  it("uses `output` when none was chosen and the agent declares none", () => {
    expect(selectedScenarioOutput({ outputField: void 0, outputs: [] })).toBe("output");
  });

  it("shows no output when the choice was cleared", () => {
    expect(selectedScenarioOutput({ outputField: "", outputs })).toBeNull();
  });

  it("shows the chosen output", () => {
    expect(selectedScenarioOutput({ outputField: "score", outputs })).toBe("score");
  });
});

describe("storedScenarioOutput", () => {
  it("stores a pick, and a cleared pick as an empty string", () => {
    expect(storedScenarioOutput("score")).toBe("score");
    expect(storedScenarioOutput(void 0)).toBe("");
  });
});

describe("outputsNamedAsOutputs", () => {
  it("names an added row as an output", () => {
    const previous = [{ identifier: "output", type: "str" }];
    const next = [...previous, { identifier: "input", type: "str" }];

    expect(outputsNamedAsOutputs({ previous, next })).toEqual([
      { identifier: "output", type: "str" },
      { identifier: "output_1", type: "str" },
    ]);
  });

  it("leaves a rename alone, even to an input-like name", () => {
    const previous = [{ identifier: "answer", type: "str" }];
    const next = [{ identifier: "input", type: "str" }];

    expect(outputsNamedAsOutputs({ previous, next })).toEqual(next);
  });

  it("keeps every other key of an existing output", () => {
    const previous = [{ identifier: "answer", type: "str", desc: "The reply" }];
    const next = [...previous, { identifier: "input", type: "str" }];

    expect(outputsNamedAsOutputs({ previous, next })[0]).toEqual(previous[0]);
  });
});
