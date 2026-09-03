/**
 * @vitest-environment node
 *
 * Streaming headlines for a CLI capability, and specifically whether a verb
 * answers with one thing or many.
 *
 * This module kept its own `COLLECTION_VERBS` set, justified by a rule about
 * not importing UI composition into a server transport. The rule is real; the
 * contract is not UI, and both sides depend on it. The copy had drifted — it
 * held `results` and lacked `tag` and `types` — so the server and the browser
 * pluralised different verbs for the same result. These cases are written
 * against `CLI_COLLECTION_VERBS` rather than against today's members, so the
 * two cannot part again.
 */
import { CLI_COLLECTION_VERBS } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";
import { resolveLangyCapabilityProgress } from "../langy-capability-progress";

const headline = (name: string): string | undefined =>
  resolveLangyCapabilityProgress(name)?.headline;

describe("resolveLangyCapabilityProgress", () => {
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
      expect(resolveLangyCapabilityProgress("not.a.capability.name")).toBeNull();
      expect(resolveLangyCapabilityProgress("langwatch.trace")).toBeNull();
    });
  });
});
