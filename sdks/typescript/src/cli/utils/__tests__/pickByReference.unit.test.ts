import { describe, expect, it } from "vitest";

import { pickByReference, ReferenceNotResolvedError } from "../pickByReference";

const rows = [
  { id: "ev_1", slug: "tone-check", name: "Tone Check" },
  { id: "ev_2", slug: "pii-guard", name: "PII Guard" },
];

const pick = (reference: string, list = rows) =>
  pickByReference({
    rows: list,
    reference,
    what: "evaluator",
    scope: "project",
    listCommand: "langwatch evaluator list",
  });

describe("pickByReference()", () => {
  describe("when the reference is a row id", () => {
    it("returns that row", () => {
      expect(pick("ev_2").id).toBe("ev_2");
    });
  });

  describe("when the reference is a row slug", () => {
    it("returns that row", () => {
      expect(pick("tone-check").id).toBe("ev_1");
    });
  });

  describe("when the reference is a display name in different case", () => {
    it("returns that row", () => {
      expect(pick("pii GUARD").id).toBe("ev_2");
    });
  });

  describe("when one row's slug equals another row's name", () => {
    it("prefers the slug match over the name match", () => {
      const list = [
        { id: "a", slug: "other", name: "billing" },
        { id: "b", slug: "billing", name: "Something Else" },
      ];
      expect(pick("billing", list).id).toBe("b");
    });
  });

  describe("when two rows share the name", () => {
    it("throws a ReferenceNotResolvedError", () => {
      const list = [
        { id: "a", slug: "x", name: "Twin" },
        { id: "b", slug: "y", name: "twin" },
      ];
      expect(() => pick("Twin", list)).toThrow(ReferenceNotResolvedError);
    });

    it("lists the ids and asks for the id", () => {
      const list = [
        { id: "a", slug: "x", name: "Twin" },
        { id: "b", slug: "y", name: "twin" },
      ];
      expect(() => pick("Twin", list)).toThrow(
        'More than one evaluator is named "Twin" (a, b). Pass the id instead.',
      );
    });
  });

  describe("when nothing matches", () => {
    it("names the reference, the scope and the list command", () => {
      expect(() => pick("nope")).toThrow(
        'No evaluator with the id, slug or name "nope" in this project. List them with `langwatch evaluator list`.',
      );
    });

    it("throws a ReferenceNotResolvedError", () => {
      expect(() => pick("nope")).toThrow(ReferenceNotResolvedError);
    });
  });
});
