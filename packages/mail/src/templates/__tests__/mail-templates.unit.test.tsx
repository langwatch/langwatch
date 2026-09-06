import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mailTemplates } from "../index";
import { renderMailTemplate, type MailTemplate } from "../registry";

/**
 * The output IS the product here, so these are snapshot tests on purpose.
 *
 * A rendered email is the artefact a person receives; there is no lower level
 * at which "the mail is right" can be checked. The assertions around the
 * snapshot are the ones a snapshot cannot make — that a link survived, that a
 * subject exists, that the dark cut is present — so a snapshot accepted without
 * reading still cannot hide a broken message.
 */

const templatesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every fixture of every template, flattened once. */
const everyFixture: readonly {
  template: MailTemplate;
  fixture: string;
  props: unknown;
}[] = mailTemplates.flatMap((template) =>
  template.fixtures.map((fixture) => ({
    template,
    fixture: fixture.name,
    props: fixture.props,
  })),
);

/** Every `https://…` or `mailto:` the props carry, wherever they carry it. */
const linksIn = (props: unknown): string[] => {
  if (typeof props === "string") {
    return /^(https?:\/\/|mailto:)/.test(props) ? [props] : [];
  }
  if (Array.isArray(props)) return props.flatMap(linksIn);
  if (typeof props === "object" && props !== null) {
    return Object.values(props).flatMap(linksIn);
  }
  return [];
};

describe("given the mail template registry", () => {
  describe("when the registry is compared against the templates folder", () => {
    /**
     * The registry is the discovery surface, so a template file it does not
     * reach is invisible to the studio and to anybody reading the list. The
     * check is on the barrel's own source because that is the single place a
     * new file has to be named, and naming it is the whole of registering it.
     *
     * @scenario "A template that is not registered is caught"
     */
    it("lists every template component file", () => {
      const barrel = readFileSync(resolve(templatesDir, "index.ts"), "utf8");
      const componentFiles = readdirSync(templatesDir)
        .filter((entry) => entry.endsWith(".tsx"))
        .filter((entry) => entry !== "email-layout.tsx");

      const unreached = componentFiles.filter(
        (file) => !barrel.includes(`"./${file.replace(/\.tsx$/, "")}"`),
      );

      expect(unreached).toEqual([]);
    });

    it("gives every template a unique identifier", () => {
      const ids = mailTemplates.map((template) => template.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every template at least one fixture", () => {
      const barren = mailTemplates.filter((template) => template.fixtures.length === 0);
      expect(barren.map((template) => template.id)).toEqual([]);
    });
  });

  describe("when props do not match the schema", () => {
    /** @scenario "Props that do not match the schema are refused" */
    it("refuses to render rather than leaving a gap in the message", () => {
      const [template] = mailTemplates;
      expect(template).toBeDefined();
      expect(() => template?.element({})).toThrow();
    });
  });
});

describe.each(everyFixture)(
  "given the $template.id email rendered from the $fixture fixture",
  ({ template, fixture, props }) => {
    describe("when it is rendered", () => {
      /** @scenario "Every fixture renders an email" */
      it("completes without failing", async () => {
        await expect(renderMailTemplate(template, props)).resolves.toBeDefined();
      });

      /** @scenario "Every rendered email carries a subject line" */
      it("comes back with a subject line", async () => {
        const { subject } = await renderMailTemplate(template, props);
        expect(subject.trim()).not.toBe("");
      });

      /** @scenario "Every rendered email has a plain text alternative" */
      it("comes back with a plain text body", async () => {
        const { text } = await renderMailTemplate(template, props);
        expect(text.trim()).not.toBe("");
      });

      /** @scenario "Every link the props carry reaches the reader" */
      it("carries every link address the props gave it", async () => {
        const { html } = await renderMailTemplate(template, props);
        for (const link of linksIn(props)) {
          expect(html).toContain(link);
        }
      });

      /** @scenario "Every email offers a dark colour scheme" */
      it("declares both colour schemes and carries the dark rules", async () => {
        const { html } = await renderMailTemplate(template, props);
        expect(html).toContain('name="color-scheme"');
        expect(html).toContain("color-scheme: light dark");
        expect(html).toContain("@media (prefers-color-scheme: dark)");
      });

      /** @scenario "Every email carries the LangWatch wordmark" */
      it("carries the wordmark with the brand name as its alternative text", async () => {
        const { html } = await renderMailTemplate(template, props);
        expect(html).toContain('alt="LangWatch"');
      });

      /**
       * The application's orange is `#ED8926` and the expressive one is
       * `#f56b1a`. Finding the first in a mail means a template drifted back
       * onto the productive system.
       *
       * @scenario "No email is dressed in the application's design system"
       */
      it("uses no colour from the application's own system", async () => {
        const { html } = await renderMailTemplate(template, props);
        expect(html.toLowerCase()).not.toContain("#ed8926");
      });

      /** @scenario "The rendered email is pinned, because the output is the product" */
      it("matches the stored snapshot", async () => {
        const { html } = await renderMailTemplate(template, props);
        expect(html).toMatchSnapshot(`${template.id} — ${fixture}`);
      });
    });
  },
);
