// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { parseScimFilter } from "../scim-filter.rules.ts";

describe("parseScimFilter", () => {
  describe("when no filter is sent", () => {
    it("lists everybody", () => {
      expect(parseScimFilter({ supported: ["userName"] })).toEqual({ ok: true, term: null });
      expect(parseScimFilter({ filter: "   ", supported: ["userName"] })).toEqual({
        ok: true,
        term: null,
      });
    });
  });

  describe("when the filter names a supported attribute", () => {
    /** @scenario "Looking somebody up by their sign-in address still works" */
    it("returns the term under the spelling the listing uses", () => {
      expect(
        parseScimFilter({ filter: 'username eq "Ada@acme.test"', supported: ["userName"] }),
      ).toEqual({ ok: true, term: { attribute: "userName", value: "Ada@acme.test" } });
    });

    it("accepts an empty value, which asks for a blank attribute", () => {
      expect(parseScimFilter({ filter: 'externalId eq ""', supported: ["externalId"] })).toEqual({
        ok: true,
        term: { attribute: "externalId", value: "" },
      });
    });
  });

  describe("when the filter names an attribute the listing cannot match", () => {
    /** @scenario "A filter on something we do not support is refused" */
    it("refuses, naming the attribute and not the value", () => {
      const parsed = parseScimFilter({
        filter: 'emails.value eq "ada@acme.test"',
        supported: ["userName"],
      });

      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("expected a refusal");
      expect(parsed.detail).toContain("emails.value");
      expect(parsed.detail).not.toContain("ada@acme.test");
    });
  });

  describe("when the filter is richer than equality", () => {
    /** @scenario "A group filter follows the same rule as a person filter" */
    it("refuses rather than half-honouring it", () => {
      for (const filter of [
        'displayName sw "Eng"',
        'displayName eq "a" and displayName eq "b"',
        "displayName pr",
      ]) {
        expect(parseScimFilter({ filter, supported: ["displayName"] }).ok).toBe(false);
      }
    });
  });
});
