import { describe, expect, it } from "vitest";

import { mailTemplates, type MailTemplate, type renderMailTemplate } from "../../src/index.ts";
import {
  arrivingSubject,
  asSentToday,
  buildDigestReview,
  DIGEST_REVIEW,
  SAMPLE_ORGANIZATION,
} from "../digest-review.ts";

describe("DIGEST_REVIEW", () => {
  /** @scenario "Digest review shows the one weekly digest that sends" */
  it("lists the weekly digest alone (digest-rows.rules.ts picks its rows)", () => {
    expect(DIGEST_REVIEW.map((entry) => entry.templateId)).toEqual(["digest-week"]);
  });

  /** @scenario "Digest review shows the one weekly digest that sends" */
  it("gives it a who-gets-this line, a version A of itself and an empty B slot", () => {
    for (const entry of DIGEST_REVIEW) {
      expect(entry.whoGetsThis.length).toBeGreaterThan(0);
      expect(entry.versionA).toEqual({
        label: "Version A: what sends today",
        templateId: entry.templateId,
      });
      expect(entry.versionB).toBeNull();
    }
  });

  it("names only props some fixture of that template sets, so a rename shows up here", () => {
    for (const entry of DIGEST_REVIEW) {
      const template = mailTemplates.find((candidate) => candidate.id === entry.templateId);
      const fixtureKeys = new Set(
        template?.fixtures.flatMap((fixture) => Object.keys(fixture.props as object)),
      );
      for (const prop of entry.notFilledToday) expect(fixtureKeys).toContain(prop);
    }
  });
});

describe("asSentToday", () => {
  /** @scenario "Digest review shows each digest as it would arrive today" */
  it("drops the props the sender leaves out and keeps the rest", () => {
    expect(
      asSentToday({
        props: { weekLabel: "Sep 22 to 28", whatsNew: { title: "x" }, filler: {} },
        notFilledToday: ["whatsNew", "filler"],
      }),
    ).toEqual({ weekLabel: "Sep 22 to 28" });
  });
});

describe("arrivingSubject", () => {
  /** @scenario "Digest review shows each digest as it would arrive today" */
  it("puts the props' organisation first", () => {
    expect(arrivingSubject({ subject: "Your week", props: { organizationName: "Globex" } })).toBe(
      "Globex: Your week",
    );
  });

  it("falls back to the sample organisation when the props name none", () => {
    expect(arrivingSubject({ subject: "Your week", props: {} })).toBe(
      `${SAMPLE_ORGANIZATION}: Your week`,
    );
  });
});

describe("buildDigestReview", () => {
  describe("given the registered templates and a renderer that records its props", () => {
    /** @scenario "Digest review shows the one weekly digest that sends" */
    it("renders every fixture of the weekly digest, as one section that sends", async () => {
      const seen: { id: string; fixture: unknown }[] = [];
      const render: typeof renderMailTemplate = (template: MailTemplate, props: unknown) => {
        seen.push({ id: template.id, fixture: props });
        return Promise.resolve({ subject: "Subject", html: "<p></p>", text: "" });
      };

      const sections = await buildDigestReview({ templates: mailTemplates, render });

      const template = mailTemplates.find((candidate) => candidate.id === "digest-week");
      expect(sections.map((section) => section.templateId)).toEqual(["digest-week"]);
      expect(sections[0]?.notSentBecause).toBeNull();
      expect(sections[0]?.versionB).toBeNull();
      expect(sections[0]?.versionA.cards.map((card) => card.fixture)).toEqual(
        template?.fixtures.map((fixture) => fixture.name),
      );
      expect(seen.every((call) => call.id === "digest-week")).toBe(true);
    });
  });
});
