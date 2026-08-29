/**
 * The identity of a target: its reference id and its parameter overrides.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalOverrides,
  canonicalParameters,
  declaredDefaults,
  differingParameterNames,
  splitTargetKey,
  targetIdentityKey,
  targetKeyOf,
  targetLabelOf,
  targetLabels,
  targetParametersLabel,
  targetSortKey,
  withCanonicalOverrides,
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

describe("targetIdentityKey", () => {
  describe("when one override holds the separators the sort key writes", () => {
    /** @scenario "A value holding a comma and an equals sign does not fake a second target" */
    it("keys two targets whose readable pairs read alike apart", () => {
      const oneValue = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { a: "b,c=d" },
      };
      const twoValues = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { a: "b", c: "d" },
      };

      expect(targetSortKey(oneValue)).toBe(targetSortKey(twoValues));
      expect(targetIdentityKey(oneValue)).not.toBe(
        targetIdentityKey(twoValues),
      );
    });
  });

  describe("when the same overrides are written in another order", () => {
    it("reads one key", () => {
      expect(
        targetIdentityKey({
          type: "http",
          referenceId: "prod-agent",
          runParameters: { model: "gpt-5-mini", locale: "de" },
        }),
      ).toBe(
        targetIdentityKey({
          type: "http",
          referenceId: "prod-agent",
          runParameters: { locale: "de", model: "gpt-5-mini" },
        }),
      );
    });
  });

  describe("when two targets of one reference id are of different types", () => {
    it("keys them apart", () => {
      expect(targetIdentityKey({ type: "http", referenceId: "abc" })).not.toBe(
        targetIdentityKey({ type: "prompt", referenceId: "abc" }),
      );
    });
  });
});

describe("targetParametersLabel", () => {
  /** @scenario "A target's parameters read as a sorted list of pairs" */
  it("lists the pairs sorted by name", () => {
    expect(
      targetParametersLabel({
        runParameters: { seats: 12, model: "gpt-5-mini" },
      }),
    ).toBe("model=gpt-5-mini, seats=12");
  });

  it("reads empty when there are none", () => {
    expect(targetParametersLabel({ runParameters: undefined })).toBe("");
    expect(targetParametersLabel({ runParameters: {} })).toBe("");
  });
});

describe("targetSortKey", () => {
  /** @scenario "The same agent twice with different parameters is two targets" */
  it("reads type, reference id and the sorted overrides, with no spaces", () => {
    expect(
      targetSortKey({
        type: "http",
        referenceId: "prod-agent",
        runParameters: { seats: 12, model: "gpt-5-mini" },
      }),
    ).toBe("http:prod-agent|model=gpt-5-mini,seats=12");
  });

  it("ends at the bar when there are no overrides", () => {
    expect(targetSortKey({ type: "http", referenceId: "prod-agent" })).toBe(
      "http:prod-agent|",
    );
    expect(
      targetSortKey({
        type: "http",
        referenceId: "prod-agent",
        runParameters: {},
      }),
    ).toBe("http:prod-agent|");
  });

  it("never carries the hash", () => {
    const target = {
      type: "http",
      referenceId: "prod-agent",
      runParameters: { model: "gpt-5-mini" },
    };

    expect(targetSortKey(target)).not.toContain(
      splitTargetKey(targetKeyOf(target)).hash,
    );
  });
});

describe("targetLabelOf", () => {
  describe("when no parameter tells the target apart", () => {
    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("reads the name alone", () => {
      expect(
        targetLabelOf({
          name: "prod-agent",
          runParameters: { locale: "de", model: "gpt-5-mini" },
          differingNames: new Set(),
        }),
      ).toBe("prod-agent");
    });
  });

  describe("when some parameters tell the target apart", () => {
    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("reads the name and those parameters only, sorted by name", () => {
      expect(
        targetLabelOf({
          name: "prod-agent",
          runParameters: { seats: 12, locale: "de", model: "gpt-5-mini" },
          differingNames: new Set(["model", "seats"]),
        }),
      ).toBe("prod-agent · model=gpt-5-mini, seats=12");
    });

    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("keeps the bare name for a target that carries none of them", () => {
      expect(
        targetLabelOf({
          name: "prod-agent",
          runParameters: { locale: "de" },
          differingNames: new Set(["model"]),
        }),
      ).toBe("prod-agent");
    });
  });
});

describe("differingParameterNames", () => {
  describe("when an agent appears once", () => {
    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("names nothing for it", () => {
      const differing = differingParameterNames([
        { referenceId: "a", runParameters: { model: "gpt-5-mini" } },
        { referenceId: "b" },
      ]);

      expect([...(differing.get("a") ?? [])]).toEqual([]);
      expect([...(differing.get("b") ?? [])]).toEqual([]);
    });
  });

  describe("when an agent appears more than once", () => {
    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("names the parameters whose values are not the same on every target of it", () => {
      const differing = differingParameterNames([
        { referenceId: "a", runParameters: { locale: "de", model: "gpt-5" } },
        {
          referenceId: "a",
          runParameters: { locale: "de", model: "gpt-5-mini" },
        },
        { referenceId: "b", runParameters: { locale: "de" } },
      ]);

      expect([...(differing.get("a") ?? [])]).toEqual(["model"]);
      expect([...(differing.get("b") ?? [])]).toEqual([]);
    });

    /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
    it("counts a parameter one target carries and another does not", () => {
      const differing = differingParameterNames([
        { referenceId: "a", runParameters: { locale: "de" } },
        { referenceId: "a", runParameters: { locale: "de", plan: "pro" } },
      ]);

      expect([...(differing.get("a") ?? [])]).toEqual(["plan"]);
    });

    it("tells a number from the string of that number", () => {
      const differing = differingParameterNames([
        { referenceId: "a", runParameters: { seats: 12 } },
        { referenceId: "a", runParameters: { seats: "12" } },
      ]);

      expect([...(differing.get("a") ?? [])]).toEqual(["seats"]);
    });
  });
});

describe("targetLabels", () => {
  /** @scenario "A target is labelled with the parameters that tell it from the other targets of its agent" */
  it("labels every target in the order given, by the one rule", () => {
    expect(
      targetLabels({
        targets: [
          { referenceId: "a", runParameters: { locale: "de" } },
          { referenceId: "a", runParameters: { locale: "de", plan: "pro" } },
          { referenceId: "b", runParameters: { locale: "de" } },
        ],
        nameOf: (target) => `agent-${target.referenceId}`,
      }),
    ).toEqual(["agent-a", "agent-a · plan=pro", "agent-b"]);
  });
});

describe("declaredDefaults", () => {
  /** @scenario "A typed default is not an override" */
  it("reads the first default of each plain parameter and no secret", () => {
    const defaults = declaredDefaults([
      { name: "model", defaultValue: "gpt-5" },
      { name: "model", defaultValue: "gpt-5-mini" },
      { name: "locale" },
      { name: "locale", defaultValue: "en" },
      { name: "api_token", secret: true },
    ]);

    expect([...defaults]).toEqual([
      ["model", "gpt-5"],
      ["locale", "en"],
    ]);
  });
});

describe("canonicalOverrides", () => {
  const defaults = new Map<string, string | number | boolean>([
    ["locale", "en"],
    ["seats", 12],
  ]);

  /** @scenario "A typed default is not an override" */
  it("keeps the values that differ from the declared default", () => {
    expect(
      canonicalOverrides({
        runParameters: { locale: "en", model: "gpt-5", seats: 12 },
        defaults,
      }),
    ).toEqual({ model: "gpt-5" });
  });

  /** @scenario "A typed default is not an override" */
  it("reads nothing when every value is its default", () => {
    expect(
      canonicalOverrides({ runParameters: { locale: "en" }, defaults }),
    ).toBeUndefined();
    expect(canonicalOverrides({ runParameters: {}, defaults })).toBeUndefined();
    expect(canonicalOverrides({ defaults })).toBeUndefined();
  });

  it("tells the string of a number from the number", () => {
    expect(
      canonicalOverrides({ runParameters: { seats: "12" }, defaults }),
    ).toEqual({ seats: "12" });
  });
});

describe("withCanonicalOverrides", () => {
  /** @scenario "Two rows that differ only by a typed default are one target" */
  it("gives two targets that differ only by a typed default one key", () => {
    const [plain, typed] = withCanonicalOverrides({
      targets: [
        { type: "http", referenceId: "agent_1" },
        {
          type: "http",
          referenceId: "agent_1",
          runParameters: { locale: "en" },
        },
      ],
      defaults: new Map([["locale", "en"]]),
    });

    expect(typed).toEqual({ type: "http", referenceId: "agent_1" });
    expect(targetKeyOf(typed!)).toBe(targetKeyOf(plain!));
  });
});
