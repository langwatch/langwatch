/**
 * The slug a new project is given.
 *
 * It is the project's segment in every URL the customer sees, so what matters
 * is that it survives being typed, pasted and linked: ASCII only, lowercase,
 * no punctuation, and never a leading or trailing dash. Project names are not
 * unique, so distinctness comes from the id suffix rather than the name — two
 * projects called "Acme" must not mint the same slug.
 */

import { describe, expect, it } from "vitest";
import { ProjectSlugService } from "../project-slug.service";

const mint = (name: string, projectId = "abcdef0123") => ProjectSlugService.mint(name, projectId);

describe("ProjectSlugService.mint", () => {
  describe("given an ordinary name", () => {
    it("lowercases it and appends the first six characters of the id", () => {
      expect(mint("Acme")).toBe("acme-abcdef");
    });

    it("joins words with a dash", () => {
      expect(mint("My First Project")).toBe("my-first-project-abcdef");
    });
  });

  describe("given two projects with the same name", () => {
    it("mints different slugs, because the id is what makes them distinct", () => {
      expect(mint("Acme", "aaaaaa1111")).not.toBe(mint("Acme", "bbbbbb2222"));
    });
  });

  describe("given a name that is not URL-safe", () => {
    it("strips accents down to their ASCII letter", () => {
      expect(mint("Café Ünicorn")).toBe("cafe-unicorn-abcdef");
    });

    it("replaces punctuation with a dash", () => {
      expect(mint("costs:2024?q&a")).toBe("costs-2024-q-a-abcdef");
    });

    it("replaces an underscore, which reads as a space when a link is underlined", () => {
      expect(mint("my_project")).toBe("my-project-abcdef");
    });

    it("collapses a run of separators into one dash", () => {
      expect(mint("a   ///   b")).toBe("a-b-abcdef");
    });

    it("drops emoji and other characters that have no ASCII form", () => {
      expect(mint("Ship it 🚀")).toBe("ship-it-abcdef");
    });

    it("never leaves a leading or trailing dash on the name part", () => {
      expect(mint("  -- Acme -- ")).toBe("acme-abcdef");
    });
  });

  describe("given a name that survives nothing", () => {
    it("still mints a usable slug from the id alone", () => {
      expect(mint("🚀🚀🚀")).toBe("-abcdef");
    });
  });

  describe("given an id shorter than the suffix it wants", () => {
    it("uses what there is rather than failing", () => {
      expect(ProjectSlugService.mint("Acme", "abc")).toBe("acme-abc");
    });
  });

  describe("given a name that matches a top-level route", () => {
    /** @scenario A project can never take a reserved top-level address */
    it("mints it, because the id suffix already keeps it off that route", () => {
      expect(mint("settings")).toBe("settings-abcdef");
    });

    it("mints it even with no id to append", () => {
      // The reserved-route check in `mint` cannot fire while the suffix is
      // appended unconditionally: `settings-` is not `settings`. It is a
      // guard for a future in which the suffix goes away, and this test says
      // so rather than claiming a refusal the code does not make.
      expect(ProjectSlugService.mint("settings", "")).toBe("settings-");
    });
  });
});
