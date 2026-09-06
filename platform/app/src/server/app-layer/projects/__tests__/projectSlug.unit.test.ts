import { describe, expect, it } from "vitest";
import {
  assertProjectSlugAllowed,
  mintProjectSlug,
  RESERVED_TOP_LEVEL_SLUGS,
} from "../projectSlug";

describe("mintProjectSlug", () => {
  describe("when a project is named after a reserved top-level route", () => {
    /** @scenario A project can never take a reserved top-level address */
    it("mints a slug that carries the id suffix, never the bare reserved name", () => {
      for (const reserved of RESERVED_TOP_LEVEL_SLUGS) {
        const slug = mintProjectSlug({
          name: reserved,
          projectNanoId: "abc123xyz",
        });
        expect(slug).toBe(`${reserved}-abc123`);
        expect(RESERVED_TOP_LEVEL_SLUGS.has(slug)).toBe(false);
      }
    });

    /** @scenario A project can never take a reserved top-level address */
    it("refuses a slug that equals a reserved top-level route", () => {
      expect(() => assertProjectSlugAllowed({ slug: "gateway" })).toThrow(
        /reserved top-level route/,
      );
      expect(() =>
        assertProjectSlugAllowed({ slug: "gateway-abc123" }),
      ).not.toThrow();
    });
  });

  describe("when a project has an ordinary name", () => {
    it("slugifies the name and appends the first six characters of the id", () => {
      expect(
        mintProjectSlug({ name: "My Cool App!", projectNanoId: "nanoid7890" }),
      ).toBe("my-cool-app-nanoid");
    });
  });
});
