import { describe, expect, it } from "vitest";
import {
  makeExperimentRunKey,
  parseExperimentRunKey,
} from "../compositeKey";

describe("makeExperimentRunKey", () => {
  it("joins experimentId and runId with a colon", () => {
    expect(makeExperimentRunKey("exp-1", "run-abc")).toBe("exp-1:run-abc");
  });

  it("handles empty experimentId", () => {
    expect(makeExperimentRunKey("", "run-abc")).toBe(":run-abc");
  });
});

describe("parseExperimentRunKey", () => {
  it("splits on the first colon", () => {
    expect(parseExperimentRunKey("exp-1:run-abc")).toEqual({
      experimentId: "exp-1",
      runId: "run-abc",
    });
  });

  it("handles colons inside the runId slug", () => {
    expect(parseExperimentRunKey("exp-1:run:with:colons")).toEqual({
      experimentId: "exp-1",
      runId: "run:with:colons",
    });
  });

  it("returns empty experimentId for legacy keys without colon", () => {
    expect(parseExperimentRunKey("run-abc")).toEqual({
      experimentId: "",
      runId: "run-abc",
    });
  });

  it("round-trips with makeExperimentRunKey", () => {
    const key = makeExperimentRunKey("exp-42", "cool-slug");
    const parsed = parseExperimentRunKey(key);
    expect(parsed).toEqual({ experimentId: "exp-42", runId: "cool-slug" });
  });
});
