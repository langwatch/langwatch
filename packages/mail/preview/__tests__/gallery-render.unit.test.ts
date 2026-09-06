import { describe, expect, it } from "vitest";
import { mailTemplates, renderMailTemplate } from "../../src/templates/index.ts";
import { buildGalleryEntries } from "../gallery-render.ts";

describe("buildGalleryEntries", () => {
  describe("given the default view", () => {
    it("returns one entry per registered template", async () => {
      const entries = await buildGalleryEntries(mailTemplates, renderMailTemplate, {
        everyFixture: false,
      });

      expect(entries).toHaveLength(mailTemplates.length);
    });

    it("carries a non-empty subject and html for every entry", async () => {
      const entries = await buildGalleryEntries(mailTemplates, renderMailTemplate, {
        everyFixture: false,
      });

      for (const entry of entries) {
        expect(entry.subject.length).toBeGreaterThan(0);
        expect(entry.html.length).toBeGreaterThan(0);
      }
    });
  });

  describe("given every fixture is requested", () => {
    /** @scenario "The studio shows every message at once" */
    it("returns one entry per registered fixture, each with a subject and a rendered body", async () => {
      const entries = await buildGalleryEntries(mailTemplates, renderMailTemplate, {
        everyFixture: true,
      });
      const totalFixtures = mailTemplates.reduce(
        (sum, template) => sum + template.fixtures.length,
        0,
      );

      expect(entries).toHaveLength(totalFixtures);
      for (const entry of entries) {
        expect(entry.subject.length).toBeGreaterThan(0);
        expect(entry.html.length).toBeGreaterThan(0);
      }
    });
  });
});
