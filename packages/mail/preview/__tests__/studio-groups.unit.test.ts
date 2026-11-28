import { describe, expect, it } from "vitest";

import {
  filterTemplates,
  groupTemplates,
  isWeeklyDigest,
  OTHER_HEADING,
  stepSelection,
} from "../studio-groups.ts";

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
        headingsOf(["upgrade-alert", "usage-limit", "reset-password", "invite", "license"]),
      ).toEqual([
        { heading: "Account and sign-in", ids: ["reset-password"] },
        { heading: "Organisation and team", ids: ["invite"] },
        { heading: "Billing and usage", ids: ["usage-limit", "license"] },
        { heading: "Alerts", ids: ["upgrade-alert"] },
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

describe("stepSelection", () => {
  // Registry order differs from list order: the alert is listed last, the invite first.
  const templates = [
    { id: "upgrade-alert", fixtures: [{ name: "default" }] },
    { id: "payment-recovery", fixtures: [{ name: "payment failed" }, { name: "reminder" }] },
    { id: "invite", fixtures: [{ name: "default" }] },
  ];

  describe("given an email with more variants after the selected one", () => {
    /** @scenario "The arrow keys step through each email's variants before the next email" */
    it("steps to its next variant before the next email", () => {
      expect(
        stepSelection({
          templates,
          selected: { id: "payment-recovery", fixture: "payment failed" },
          direction: 1,
        }),
      ).toEqual({ id: "payment-recovery", fixture: "reminder" });
    });
  });

  describe("given the last variant of an email", () => {
    /** @scenario "The arrow keys step through each email's variants before the next email" */
    it("steps on to the next email in list order", () => {
      expect(
        stepSelection({
          templates,
          selected: { id: "payment-recovery", fixture: "reminder" },
          direction: 1,
        }),
      ).toEqual({ id: "upgrade-alert", fixture: "default" });
    });
  });

  describe("given the first variant of an email, stepping back", () => {
    it("lands on the previous email's last variant", () => {
      expect(
        stepSelection({
          templates,
          selected: { id: "upgrade-alert", fixture: "default" },
          direction: -1,
        }),
      ).toEqual({ id: "payment-recovery", fixture: "reminder" });
    });
  });

  describe("given either end of the list", () => {
    /** @scenario "The arrow keys step through each email's variants before the next email" */
    it("wraps from the last stop to the first", () => {
      expect(
        stepSelection({
          templates,
          selected: { id: "upgrade-alert", fixture: "default" },
          direction: 1,
        }),
      ).toEqual({ id: "invite", fixture: "default" });
    });

    it("wraps from the first stop to the last", () => {
      expect(
        stepSelection({ templates, selected: { id: "invite", fixture: "default" }, direction: -1 }),
      ).toEqual({ id: "upgrade-alert", fixture: "default" });
    });
  });

  describe("given nothing selected, or a selection the list no longer has", () => {
    it("lands on the first stop", () => {
      expect(stepSelection({ templates, selected: null, direction: 1 })).toEqual({
        id: "invite",
        fixture: "default",
      });
      expect(
        stepSelection({ templates, selected: { id: "gone", fixture: "default" }, direction: -1 }),
      ).toEqual({ id: "invite", fixture: "default" });
    });
  });

  describe("given no templates", () => {
    it("returns null", () => {
      expect(stepSelection({ templates: [], selected: null, direction: 1 })).toBeNull();
    });
  });
});

describe("filterTemplates", () => {
  const templates = [
    { title: "Reset password" },
    { title: "Weekly digest: traces week" },
    { title: "Weekly digest: plan pressure" },
  ];

  /** @scenario "The studio's message list can be searched by name" */
  it("keeps only the names holding the query, ignoring case and surrounding spaces", () => {
    expect(filterTemplates({ templates, query: "  DIGEST " }).map((entry) => entry.title)).toEqual([
      "Weekly digest: traces week",
      "Weekly digest: plan pressure",
    ]);
  });

  it("keeps every template for an empty query", () => {
    expect(filterTemplates({ templates, query: "" })).toEqual(templates);
  });

  it("returns none when no name matches", () => {
    expect(filterTemplates({ templates, query: "invoice" })).toEqual([]);
  });
});

describe("isWeeklyDigest", () => {
  /** @scenario "The weekly digests sit only on their own tab" */
  it("picks out the weekly digests, which have their own tab", () => {
    expect(isWeeklyDigest("digest-week")).toBe(true);
  });

  /** @scenario "The weekly digests sit only on their own tab" */
  it("keeps the automation trigger email with all other emails", () => {
    expect(isWeeklyDigest("trigger-digest")).toBe(false);
    expect(headingsOf(["trigger-digest"])).toEqual([
      { heading: "Alerts", ids: ["trigger-digest"] },
    ]);
  });
});
