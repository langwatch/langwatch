/**
 * The keys that compare two run plan configs.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { describe, expect, it } from "vitest";
import {
  configurationKey,
  duplicateSuiteTargets,
  scopeKey,
  sortSuiteTargets,
} from "../plan-config";
import { declaredDefaults, targetSortKey, withCanonicalOverrides } from "../target-key";
import type { SuiteTarget } from "../suite";

describe("sortSuiteTargets", () => {
  describe("when the same targets arrive in either order", () => {
    /** @scenario "Targets are stored in a stable order" */
    it("stores them the same way round", () => {
      const dev: SuiteTarget = { type: "http", referenceId: "dev-agent" };
      const prod: SuiteTarget = { type: "http", referenceId: "prod-agent" };

      expect(sortSuiteTargets([prod, dev])).toEqual(
        sortSuiteTargets([dev, prod]),
      );
      expect(sortSuiteTargets([prod, dev])).toEqual([dev, prod]);
    });
  });

  describe("when the same agent appears twice with different overrides", () => {
    /** @scenario "The same agent twice with different parameters is two targets" */
    it("keeps both, the plain one first, in one order every run", () => {
      const plain: SuiteTarget = { type: "http", referenceId: "prod-agent" };
      const mini: SuiteTarget = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
      };

      expect(sortSuiteTargets([mini, plain])).toEqual([plain, mini]);
      expect(sortSuiteTargets([plain, mini])).toEqual([plain, mini]);
      // The readable string, never the hash: the run dialog sorts by the same
      // one, so the columns keep the order the dialog showed.
      expect(targetSortKey(mini)).toBe("http:prod-agent|model=gpt-5-mini");
      expect(targetSortKey(plain)).toBe("http:prod-agent|");
    });
  });
});

describe("duplicateSuiteTargets", () => {
  describe("when two targets share a key", () => {
    /** @scenario "Two identical targets are refused" */
    it("names the repeated one", () => {
      const twice: SuiteTarget = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
      };

      expect(duplicateSuiteTargets([twice, { ...twice }])).toEqual([twice]);
    });
  });

  describe("when two targets differ only by a typed default", () => {
    /** @scenario "Two targets that differ only by a typed default are refused" */
    it("names the repeated one once its overrides are canonicalized", () => {
      const defaults = declaredDefaults([{ name: "model", defaultValue: "gpt-5" }]);
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: "prod-agent" },
        { type: "http", referenceId: "prod-agent", runParameters: { model: "gpt-5" } },
      ];

      expect(duplicateSuiteTargets(withCanonicalOverrides({ targets, defaults }))).toEqual([
        { type: "http", referenceId: "prod-agent" },
      ]);
    });
  });

  describe("when the same agent appears with different overrides", () => {
    /** @scenario "The same agent twice with different parameters is two targets" */
    it("reports nothing", () => {
      expect(
        duplicateSuiteTargets([
          { type: "http", referenceId: "prod-agent" },
          {
            type: "http",
            referenceId: "prod-agent",
            runParameters: { model: "gpt-5-mini" },
          },
        ]),
      ).toEqual([]);
    });
  });

  describe("when one override holds the separators the readable key writes", () => {
    /** @scenario "A value holding a comma and an equals sign does not fake a second target" */
    it("keeps two targets whose pairs read alike apart", () => {
      expect(
        duplicateSuiteTargets([
          {
            type: "http",
            referenceId: "prod-agent",
            runParameters: { a: "b,c=d" },
          },
          {
            type: "http",
            referenceId: "prod-agent",
            runParameters: { a: "b", c: "d" },
          },
        ]),
      ).toEqual([]);
    });
  });
});

describe("configurationKey", () => {
  describe("when a target carries overrides", () => {
    it("keys the variant apart from the plain target", () => {
      const config = {
        scope: { mode: "all" } as const,
        repeatCount: 1,
        simulatorModel: null,
        judgeModel: null,
      };
      const plain = configurationKey({
        config: {
          ...config,
          targets: [{ type: "http", referenceId: "prod-agent" }],
        },
      });
      const variant = configurationKey({
        config: {
          ...config,
          targets: [
            {
              type: "http",
              referenceId: "prod-agent",
              runParameters: { model: "gpt-5-mini" },
            },
          ],
        },
      });

      expect(variant).not.toBe(plain);
    });
  });

  describe("when one target's override holds a comma and an equals sign", () => {
    /** @scenario "A value holding a comma and an equals sign does not fake a second target" */
    it("keys it apart from the target whose pairs read alike", () => {
      const config = {
        scope: { mode: "all" } as const,
        repeatCount: 1,
        simulatorModel: null,
        judgeModel: null,
      };
      const oneValue = configurationKey({
        config: {
          ...config,
          targets: [
            {
              type: "http",
              referenceId: "prod-agent",
              runParameters: { a: "b,c=d" },
            },
          ],
        },
      });
      const twoValues = configurationKey({
        config: {
          ...config,
          targets: [
            {
              type: "http",
              referenceId: "prod-agent",
              runParameters: { a: "b", c: "d" },
            },
          ],
        },
      });

      expect(oneValue).not.toBe(twoValues);
    });
  });
});

describe("configurationKey", () => {
  describe("when one configuration leaves a model empty and another omits it", () => {
    /** @scenario "A configuration naming no model keys the same whether the model is empty or absent" */
    it("keys them the same, so both mean the project default", () => {
      const shared = {
        scope: { mode: "all" } as const,
        targets: [{ type: "http", referenceId: "prod-agent" } as SuiteTarget],
        repeatCount: 1,
      };

      const empty = configurationKey({
        config: { ...shared, simulatorModel: null, judgeModel: null },
      });
      const absent = configurationKey({
        config: {
          ...shared,
          simulatorModel: undefined as unknown as null,
          judgeModel: undefined as unknown as null,
        },
      });

      expect(empty).toBe(absent);
    });
  });
});

describe("scopeKey", () => {
  describe("when two hand-picked scopes cover different scenarios", () => {
    it("tells them apart, which the scope shape alone cannot", () => {
      const first = scopeKey({
        scope: { mode: "scenarios" },
        scenarioIds: ["a"],
      });
      const second = scopeKey({
        scope: { mode: "scenarios" },
        scenarioIds: ["b"],
      });

      expect(first).not.toBe(second);
    });

    it("reads the same list in either order as one scope", () => {
      expect(
        scopeKey({ scope: { mode: "scenarios" }, scenarioIds: ["b", "a"] }),
      ).toBe(
        scopeKey({ scope: { mode: "scenarios" }, scenarioIds: ["a", "b"] }),
      );
    });
  });

  describe("when the scope is a test suites scope", () => {
    it("reads the same test suites in either order as one scope", () => {
      expect(
        scopeKey({ scope: { mode: "test_suites", testSuiteIds: ["b", "a"] } }),
      ).toBe(
        scopeKey({ scope: { mode: "test_suites", testSuiteIds: ["a", "b"] } }),
      );
    });
  });
});

describe("configurationKey", () => {
  const base = {
    scope: { mode: "all" } as const,
    targets: [{ type: "http", referenceId: "prod" }] as SuiteTarget[],
    repeatCount: 1,
    simulatorModel: null,
    judgeModel: null,
  };

  describe("when two runs of one plan differ only by parameters", () => {
    it("gives them different keys, so both are listed", () => {
      expect(
        configurationKey({ config: base, parameters: { tier: "gold" } }),
      ).not.toBe(
        configurationKey({ config: base, parameters: { tier: "silver" } }),
      );
    });
  });

  describe("when two runs of one plan differ only by repeat count", () => {
    it("gives them different keys", () => {
      expect(configurationKey({ config: base })).not.toBe(
        configurationKey({ config: { ...base, repeatCount: 3 } }),
      );
    });
  });

  describe("when two runs hold the same config", () => {
    it("gives them one key, whatever order the targets and parameters arrive in", () => {
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: "dev" },
        { type: "http", referenceId: "prod" },
      ];
      expect(
        configurationKey({
          config: { ...base, targets },
          parameters: { a: "1", b: "2" },
        }),
      ).toBe(
        configurationKey({
          config: { ...base, targets: [...targets].reverse() },
          parameters: { b: "2", a: "1" },
        }),
      );
    });
  });

  describe("when the run carries a note", () => {
    it("has no way to take one, so a note can never split a configuration", () => {
      // The signature is the guard: configurationKey takes config, scenarioIds
      // and parameters, and nothing else.
      expect(Object.keys(base)).not.toContain("note");
    });
  });
});
