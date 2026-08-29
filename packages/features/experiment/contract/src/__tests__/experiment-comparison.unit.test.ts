import { describe, expect, it } from "vitest";
import { resolveExperimentVerdictLabel } from "../experiment-comparison";

describe("resolveExperimentVerdictLabel", () => {
  it("maps legacy slot labels by position", () => {
    const variants = ["target-a", "target-b"];

    expect(resolveExperimentVerdictLabel({ label: "A", variants })).toBe("target-a");
    expect(resolveExperimentVerdictLabel({ label: "B", variants })).toBe("target-b");
  });

  it("preserves current identifiers, including identifiers named A or B", () => {
    expect(resolveExperimentVerdictLabel({ label: "A", variants: ["A", "B"] })).toBe("A");
    expect(resolveExperimentVerdictLabel({ label: "B", variants: ["A", "B"] })).toBe("B");
  });

  it("passes ties and unknown labels through", () => {
    const variants = ["target-a"];

    expect(resolveExperimentVerdictLabel({ label: "tie", variants })).toBe("tie");
    expect(resolveExperimentVerdictLabel({ label: "target-c", variants })).toBe(
      "target-c",
    );
    expect(resolveExperimentVerdictLabel({ label: "B", variants })).toBe("B");
  });
});
