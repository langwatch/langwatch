import { describe, expect, it } from "vitest";

import { groupTemplates, OTHER_HEADING } from "../studio-groups.ts";

const headingsOf = (ids: string[]) =>
  groupTemplates({ templates: ids.map((id) => ({ id })) }).map((group) => ({
    heading: group.heading,
    ids: group.templates.map((template) => template.id),
  }));

describe("groupTemplates", () => {
  describe("given templates from several areas, out of heading order", () => {
    /** @scenario "The studio lists every message under a plain heading" */
    it("lists them under the fixed headings in heading order, keeping registry order within each", () => {
      expect(
        headingsOf(["digest-whats-new", "usage-limit", "reset-password", "invite", "license"]),
      ).toEqual([
        { heading: "Account and sign-in", ids: ["reset-password"] },
        { heading: "Organisation and team", ids: ["invite"] },
        { heading: "Billing and usage", ids: ["usage-limit", "license"] },
        { heading: "Weekly digest", ids: ["digest-whats-new"] },
      ]);
    });
  });

  describe("given a new digest the map does not name", () => {
    it("files it under Weekly digest by its prefix", () => {
      expect(headingsOf(["digest-brand-new"])).toEqual([
        { heading: "Weekly digest", ids: ["digest-brand-new"] },
      ]);
    });
  });

  describe("given trigger-digest, which is not a weekly digest", () => {
    it("files it under Alerts", () => {
      expect(headingsOf(["trigger-digest"])).toEqual([
        { heading: "Alerts", ids: ["trigger-digest"] },
      ]);
    });
  });

  describe("given an id no heading claims", () => {
    /** @scenario "The studio lists every message under a plain heading" */
    it("files it under Other, after every named heading", () => {
      expect(headingsOf(["something-unmapped", "invite"])).toEqual([
        { heading: "Organisation and team", ids: ["invite"] },
        { heading: OTHER_HEADING, ids: ["something-unmapped"] },
      ]);
    });
  });

  describe("given no templates", () => {
    it("returns no headings", () => {
      expect(headingsOf([])).toEqual([]);
    });
  });
});
