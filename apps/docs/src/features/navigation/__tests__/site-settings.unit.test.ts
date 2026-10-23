import { describe, expect, it } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { buildNav } from "../compile/nav.ts";

const PAGES = {
  "guide.mdx": "---\ntitle: Guide\n---\nHello",
  "old.mdx": "---\ntitle: Old\ndeprecated: true\n---\nGone soon",
  "tagged.mdx": "---\ntitle: Tagged\ntag: Beta\n---\nNew",
};

function settingsFixture({ config }: { config: Record<string, unknown> }) {
  return docsFixture({
    config: {
      navigation: { anchors: [{ anchor: "Docs", pages: ["guide", "old", "tagged"] }] },
      ...config,
    },
    pages: PAGES,
  });
}

describe("site settings from docs.json", () => {
  describe("when docs.json sets a banner, page actions, a tag manager and 404 copy", () => {
    /** @scenario "Show the authored announcement beside the release update" */
    it("compiles them into the site the shell renders", () => {
      const fixture = settingsFixture({
        config: {
          description: "The LLMOps platform.",
          banner: { content: "**New:** [Skills](/skills/directory)", dismissible: true },
          contextual: { options: ["view", "copy", "perplexity", "mcp"] },
          integrations: { gtm: { tagId: "GTM-ABC123" } },
          navbar: { links: [{ label: "llms.txt", href: "https://docs.langwatch.ai/llms.txt" }] },
          errors: {
            "404": { title: "Moved", description: "Start from the [introduction](/introduction)." },
          },
          seo: { organization: { name: "LangWatch", url: "https://langwatch.ai" } },
        },
      });
      try {
        const { site } = buildNav({ docsRoot: fixture.docsRoot });
        expect(site.description).toBe("The LLMOps platform.");
        expect(site.announcement).toMatchObject({
          id: expect.stringMatching(/^announcement:[0-9a-f]{12}$/),
          dismissible: true,
          content: [
            { type: "strong", children: [{ type: "text", value: "New:" }] },
            { type: "text", value: " " },
            { type: "link", href: "/skills/directory" },
          ],
        });
        expect(site.contextual).toEqual(["view", "copy", "mcp"]);
        expect(site.tagManager).toBe("GTM-ABC123");
        expect(site.llms).toBe("/llms.txt");
        expect(site.notFound.title).toBe("Moved");
        expect(site.notFound.content).toContainEqual(
          expect.objectContaining({ type: "link", href: "/introduction" }),
        );
        expect(site.organization).toEqual({
          name: "LangWatch",
          url: "https://langwatch.ai",
          logo: "",
          sameAs: [],
        });
      } finally {
        fixture.dispose();
      }
    });

    /** @scenario "Show the authored announcement beside the release update" */
    it("keys the announcement by its content", () => {
      const first = settingsFixture({ config: { banner: { content: "One" } } });
      const second = settingsFixture({ config: { banner: { content: "Two" } } });
      try {
        const one = buildNav({ docsRoot: first.docsRoot }).site.announcement;
        const two = buildNav({ docsRoot: second.docsRoot }).site.announcement;
        expect(one?.id).not.toBe(two?.id);
        expect(one?.dismissible).toBe(false);
      } finally {
        first.dispose();
        second.dispose();
      }
    });
  });

  describe("when docs.json sets none of them", () => {
    /** @scenario "Show the authored announcement beside the release update" */
    it("shows no announcement, no page actions and no tag", () => {
      const fixture = settingsFixture({ config: {} });
      try {
        const { site } = buildNav({ docsRoot: fixture.docsRoot });
        expect(site.announcement).toBeNull();
        expect(site.contextual).toEqual([]);
        expect(site.tagManager).toBe("");
        expect(site.organization).toBeNull();
      } finally {
        fixture.dispose();
      }
    });
  });

  describe("when a page is deprecated or tagged", () => {
    /** @scenario "Mark deprecated pages" */
    it("tags it, Deprecated for a deprecated page", () => {
      const fixture = settingsFixture({ config: {} });
      try {
        const { pages } = buildNav({ docsRoot: fixture.docsRoot });
        expect([pages.guide?.tag, pages.old?.tag, pages.tagged?.tag]).toEqual([
          "",
          "Deprecated",
          "Beta",
        ]);
      } finally {
        fixture.dispose();
      }
    });
  });

  describe("when the docs are outside a git checkout", () => {
    /** @scenario "Show when a page was last updated" */
    it("dates no page even with timestamps on", () => {
      const fixture = settingsFixture({ config: { metadata: { timestamp: true } } });
      try {
        const { pages } = buildNav({ docsRoot: fixture.docsRoot });
        expect(Object.values(pages).map((page) => page.updated)).toEqual(["", "", ""]);
      } finally {
        fixture.dispose();
      }
    });
  });
});
