import { describe, expect, it } from "vitest";

import { selectedScenarioOutput, storedScenarioOutput } from "../scenario-output-field.ts";

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
