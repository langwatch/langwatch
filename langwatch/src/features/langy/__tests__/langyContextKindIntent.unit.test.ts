import { describe, expect, it } from "vitest";
import {
  kindIntentForQuery,
  SURFACE_PATH_FOR_KIND,
} from "../logic/langyContextKindIntent";

describe("kindIntentForQuery", () => {
  describe("given the page has trace targets mounted", () => {
    const presentKinds = new Set(["trace"]);

    describe("when the # query names traces", () => {
      it("offers to show them on this page", () => {
        const intent = kindIntentForQuery({ query: "traces", presentKinds });

        expect(intent).toMatchObject({ kind: "trace", action: "reveal" });
        expect(intent?.label).toBe("Show traces on this page");
      });

      it("answers a prefix of the kind, so #tra lands the same", () => {
        expect(
          kindIntentForQuery({ query: "tra", presentKinds }),
        ).toMatchObject({ kind: "trace", action: "reveal" });
      });

      it("answers the singular as well as the plural", () => {
        expect(
          kindIntentForQuery({ query: "trace", presentKinds }),
        ).toMatchObject({ kind: "trace", action: "reveal" });
      });
    });

    describe("when the query names a kind that is NOT on this page", () => {
      it("offers to browse the surface that has them", () => {
        const intent = kindIntentForQuery({ query: "datasets", presentKinds });

        expect(intent).toMatchObject({ kind: "dataset", action: "browse" });
        expect(intent?.label).toBe("Browse datasets");
      });
    });
  });

  describe("given aliases a user would actually type", () => {
    const none = new Set<string>();

    it("maps #eval to evaluations", () => {
      expect(kindIntentForQuery({ query: "eval", presentKinds: none })).toMatchObject(
        { kind: "evaluation" },
      );
    });

    it("maps #monitor to evaluations", () => {
      expect(
        kindIntentForQuery({ query: "monitor", presentKinds: none }),
      ).toMatchObject({ kind: "evaluation" });
    });

    it("maps #simulation to scenarios", () => {
      expect(
        kindIntentForQuery({ query: "simulation", presentKinds: none }),
      ).toMatchObject({ kind: "scenario" });
    });

    it("maps #messages to traces", () => {
      expect(
        kindIntentForQuery({ query: "messages", presentKinds: none }),
      ).toMatchObject({ kind: "trace" });
    });
  });

  describe("given a query that names no kind", () => {
    it("offers nothing", () => {
      expect(
        kindIntentForQuery({ query: "my-checkout-flow", presentKinds: new Set() }),
      ).toBeNull();
    });
  });

  describe("given a single-character query", () => {
    it("offers nothing — too little signal to mean a kind", () => {
      expect(
        kindIntentForQuery({ query: "t", presentKinds: new Set(["trace"]) }),
      ).toBeNull();
    });
  });

  describe("given an empty query", () => {
    it("offers nothing", () => {
      expect(
        kindIntentForQuery({ query: "  ", presentKinds: new Set(["trace"]) }),
      ).toBeNull();
    });
  });
});

describe("SURFACE_PATH_FOR_KIND", () => {
  describe("when a browse intent needs a destination", () => {
    it("maps every revealable kind to a project surface", () => {
      expect(SURFACE_PATH_FOR_KIND).toEqual({
        trace: "traces",
        dataset: "datasets",
        prompt: "prompts",
        evaluation: "evaluations",
        scenario: "simulations",
        experiment: "evaluations",
      });
    });
  });
});
