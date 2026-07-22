/**
 * The CLI verb/resource grammar, pinned at its source. This package is the one
 * place both the CLI and the Langy panel read WHICH card a command produces and
 * WHAT TONE its verb carries, so the contract is tested here rather than only
 * through a consumer.
 */
import { describe, expect, it } from "vitest";
import {
  cardKindFor,
  cliVerbTone,
  CLI_COLLECTION_VERBS,
  CLI_SUBRESOURCE_VERBS,
} from "./registry.js";

describe("cardKindFor, given a CLI resource and verb", () => {
  describe("when the command reads traces", () => {
    it("draws the search sample for a search and one trace for a get", () => {
      expect(cardKindFor({ resource: "trace", verb: "search" })).toBe("traces");
      expect(cardKindFor({ resource: "trace", verb: "get" })).toBe("trace");
    });
  });

  describe("when the command runs an experiment", () => {
    it("draws the run card for run/results/status", () => {
      expect(cardKindFor({ resource: "experiment", verb: "run" })).toBe(
        "evalRun",
      );
      expect(cardKindFor({ resource: "experiment", verb: "results" })).toBe(
        "evalRun",
      );
      expect(cardKindFor({ resource: "experiment", verb: "status" })).toBe(
        "evalRun",
      );
    });

    it("draws the generic resource card for a plain get, not a run card", () => {
      // An `experiment get` returns the experiment's config, not a run's
      // pass/fail — so it reads as a resource, not an evaluation run.
      expect(cardKindFor({ resource: "experiment", verb: "get" })).toBe(
        "resourceRead",
      );
    });
  });

  describe("when the command writes", () => {
    it("draws a card tinted by the write verb, whatever the resource", () => {
      expect(cardKindFor({ resource: "dataset", verb: "create" })).toBe(
        "resourceCreated",
      );
      expect(cardKindFor({ resource: "monitor", verb: "update" })).toBe(
        "resourceUpdated",
      );
      expect(cardKindFor({ resource: "trigger", verb: "delete" })).toBe(
        "resourceRemoved",
      );
    });

    it("draws the diff card for a prompt push or sync", () => {
      expect(cardKindFor({ resource: "prompt", verb: "push" })).toBe(
        "promptDiff",
      );
      expect(cardKindFor({ resource: "prompt", verb: "sync" })).toBe(
        "promptDiff",
      );
    });
  });

  describe("when the resource is one this registry has never heard of", () => {
    it("falls back to the generic resource card rather than to nothing", () => {
      expect(cardKindFor({ resource: "quasar", verb: "list" })).toBe(
        "resourceRead",
      );
    });
  });
});

describe("cliVerbTone, given a CLI verb", () => {
  describe("when the verb reads", () => {
    it("is inert", () => {
      expect(cliVerbTone("get")).toBe("read");
      expect(cliVerbTone("list")).toBe("read");
      expect(cliVerbTone("search")).toBe("read");
    });
  });

  describe("when the verb writes", () => {
    it("carries the write's tone", () => {
      expect(cliVerbTone("create")).toBe("created");
      expect(cliVerbTone("update")).toBe("updated");
      expect(cliVerbTone("delete")).toBe("removed");
    });

    it("reads a sync/push as updated even though its CARD is the prompt diff", () => {
      // Tone and card answer different questions of the same verb: a `sync`
      // updates (tone) and shows a diff (card), and both live in this one place.
      expect(cliVerbTone("sync")).toBe("updated");
      expect(cliVerbTone("push")).toBe("updated");
      expect(cardKindFor({ resource: "prompt", verb: "sync" })).toBe(
        "promptDiff",
      );
    });

    it("reads a key rotation and a default reset as updates", () => {
      // `virtual-keys rotate` replaces the key material of an existing key;
      // `model-default unset` resets a default — both change an existing
      // resource, so both carry the updated tone and card.
      expect(cliVerbTone("rotate")).toBe("updated");
      expect(cliVerbTone("unset")).toBe("updated");
      expect(cardKindFor({ resource: "virtual-keys", verb: "rotate" })).toBe(
        "resourceUpdated",
      );
      expect(cardKindFor({ resource: "model-default", verb: "unset" })).toBe(
        "resourceUpdated",
      );
    });
  });
});

describe("CLI_COLLECTION_VERBS", () => {
  it("holds the verbs that read a collection rather than one resource", () => {
    expect(CLI_COLLECTION_VERBS.has("list")).toBe(true);
    expect(CLI_COLLECTION_VERBS.has("search")).toBe(true);
    expect(CLI_COLLECTION_VERBS.has("records")).toBe(true);
    expect(CLI_COLLECTION_VERBS.has("get")).toBe(false);
  });

  /** @scenario The type catalog renders as a collection */
  it("counts the evaluator type catalog as a collection", () => {
    expect(CLI_COLLECTION_VERBS.has("types")).toBe(true);
  });
});

describe("CLI_SUBRESOURCE_VERBS", () => {
  // `evaluator types` answers with the catalog, whose rows carry a `slug` the
  // id convention would read as an evaluator. Hydrated as saved evaluators, a
  // complete catalog resolves to nothing and draws as "no evaluators".
  /** @scenario Catalog types are never looked up as the project's saved evaluators */
  it("keeps the type catalog out of parent-resource id lookup", () => {
    expect(CLI_SUBRESOURCE_VERBS.has("types")).toBe(true);
  });
});
