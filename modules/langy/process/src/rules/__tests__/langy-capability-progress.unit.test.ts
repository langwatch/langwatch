/**
 * @vitest-environment node
 *
 * Locks verb pluralisation to `CLI_COLLECTION_VERBS` so server and browser can't drift again.
 */
import { CLI_COLLECTION_VERBS } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { deriveLangyCapabilityProgress } from "../langy-capability-progress.rules.ts";

const headline = (name: string): string | undefined =>
  deriveLangyCapabilityProgress(name)?.headline;

describe("deriveLangyCapabilityProgress", () => {
  describe("given a verb the contract counts as a collection", () => {
    it("pluralises the resource for every one of them", () => {
      for (const verb of CLI_COLLECTION_VERBS) {
        expect(headline(`langwatch.trace.${verb}`)).toContain("traces");
      }
    });

    it("covers the two the server copy was missing", () => {
      expect(CLI_COLLECTION_VERBS.has("tag")).toBe(true);
      expect(CLI_COLLECTION_VERBS.has("types")).toBe(true);
      expect(headline("langwatch.trace.tag")).toContain("traces");
      expect(headline("langwatch.trace.types")).toContain("traces");
    });
  });

  describe("given a verb the contract does not count as a collection", () => {
    it("keeps the resource singular", () => {
      expect(CLI_COLLECTION_VERBS.has("get")).toBe(false);
      expect(headline("langwatch.trace.get")).toContain("trace");
      expect(headline("langwatch.trace.get")).not.toContain("traces");
    });

    it("agrees with the browser about `results`, which the copy pluralised", () => {
      expect(CLI_COLLECTION_VERBS.has("results")).toBe(false);
      expect(headline("langwatch.trace.results")).not.toContain("traces");
    });
  });

  describe("given a name that is not a capability", () => {
    it("answers nothing rather than inventing wording", () => {
      expect(deriveLangyCapabilityProgress("not.a.capability.name")).toBeNull();
      expect(deriveLangyCapabilityProgress("langwatch.trace")).toBeNull();
    });
  });
});
