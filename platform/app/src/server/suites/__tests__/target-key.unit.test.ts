/**
 * The identity of a target: its reference id and its parameter overrides.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalParameters,
  repeatedReferenceIds,
  splitTargetKey,
  targetKeyOf,
  targetLabelOf,
  targetParametersLabel,
} from "../target-key";

/** The first eight hex characters of node's own SHA-1, the reference answer. */
function referenceHash(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8);
}

describe("targetKeyOf", () => {
  describe("when the target carries no overrides", () => {
    /** @scenario "A target with no overrides keys as its reference id alone" */
    it("keys as the reference id alone", () => {
      expect(targetKeyOf({ referenceId: "prod-agent" })).toBe("prod-agent");
      expect(
        targetKeyOf({ referenceId: "prod-agent", runParameters: {} }),
      ).toBe("prod-agent");
    });
  });

  describe("when the target carries overrides", () => {
    /** @scenario "A target with overrides keys as its reference id and a hash of the overrides" */
    it("keys as the reference id, a hash mark and eight hex characters", () => {
      const key = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
      });

      expect(key).toMatch(/^prod-agent#[0-9a-f]{8}$/);
    });

    /** @scenario "A target with overrides keys as its reference id and a hash of the overrides" */
    it("takes one key whichever order the overrides were written in", () => {
      const first = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini", seats: 12 },
      });
      const second = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: { seats: 12, model: "gpt-5-mini" },
      });

      expect(first).toBe(second);
    });

    /** @scenario "A target with overrides keys as its reference id and a hash of the overrides" */
    it("takes another key for another value", () => {
      const mini = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
      });
      const full = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5" },
      });

      expect(mini).not.toBe(full);
    });

    it("hashes the canonical overrides with SHA-1, the way node does", () => {
      const cases: Record<string, string | number | boolean>[] = [
        { model: "gpt-5-mini" },
        { seats: 12, model: "gpt-5-mini", trial: false },
        { note: "ünïcödé and emoji 🚀" },
        { long: "x".repeat(200) },
      ];
      for (const runParameters of cases) {
        const expected = referenceHash(canonicalParameters(runParameters));
        expect(targetKeyOf({ referenceId: "a", runParameters })).toBe(
          `a#${expected}`,
        );
      }
    });

    it("tells a number from the string of that number", () => {
      const asNumber = targetKeyOf({
        referenceId: "a",
        runParameters: { seats: 12 },
      });
      const asString = targetKeyOf({
        referenceId: "a",
        runParameters: { seats: "12" },
      });

      expect(asNumber).not.toBe(asString);
    });
  });
});

describe("splitTargetKey", () => {
  /** @scenario "A target key splits back into its reference id and its hash" */
  it("reads the reference id and the hash back off a key with overrides", () => {
    const key = targetKeyOf({
      referenceId: "prod-agent",
      runParameters: { model: "gpt-5-mini" },
    });

    const split = splitTargetKey(key);

    expect(split.referenceId).toBe("prod-agent");
    expect(split.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(key).toBe(`prod-agent#${split.hash}`);
  });

  /** @scenario "A target key splits back into its reference id and its hash" */
  it("reads no hash off a key with no overrides", () => {
    expect(splitTargetKey("prod-agent")).toEqual({
      referenceId: "prod-agent",
      hash: null,
    });
  });

  it("keeps a hash mark that is not followed by a hash inside the reference id", () => {
    expect(splitTargetKey("odd#name")).toEqual({
      referenceId: "odd#name",
      hash: null,
    });
    expect(splitTargetKey("code:acme#1")).toEqual({
      referenceId: "code:acme#1",
      hash: null,
    });
  });
});

describe("targetParametersLabel", () => {
  /** @scenario "A target's parameters read as a sorted list of pairs" */
  it("lists the pairs sorted by name", () => {
    expect(targetParametersLabel({ seats: 12, model: "gpt-5-mini" })).toBe(
      "model=gpt-5-mini, seats=12",
    );
  });

  it("reads empty when there are none", () => {
    expect(targetParametersLabel(undefined)).toBe("");
    expect(targetParametersLabel({})).toBe("");
  });
});

describe("targetLabelOf", () => {
  describe("when the agent appears once in the run", () => {
    /** @scenario "A target is labelled with its parameters only when its agent is repeated" */
    it("reads the name alone", () => {
      expect(
        targetLabelOf({
          name: "prod-agent",
          runParameters: { model: "gpt-5-mini" },
          duplicated: false,
        }),
      ).toBe("prod-agent");
    });
  });

  describe("when the agent appears more than once in the run", () => {
    /** @scenario "A target is labelled with its parameters only when its agent is repeated" */
    it("reads the name and the parameters", () => {
      expect(
        targetLabelOf({
          name: "prod-agent",
          runParameters: { model: "gpt-5-mini" },
          duplicated: true,
        }),
      ).toBe("prod-agent · model=gpt-5-mini");
    });

    /** @scenario "A target is labelled with its parameters only when its agent is repeated" */
    it("keeps the bare name for the one that carries no overrides", () => {
      expect(targetLabelOf({ name: "prod-agent", duplicated: true })).toBe(
        "prod-agent",
      );
    });
  });
});

describe("repeatedReferenceIds", () => {
  it("names the reference ids that appear more than once", () => {
    const repeated = repeatedReferenceIds([
      { referenceId: "a" },
      { referenceId: "b" },
      { referenceId: "a" },
    ]);

    expect([...repeated]).toEqual(["a"]);
  });
});
