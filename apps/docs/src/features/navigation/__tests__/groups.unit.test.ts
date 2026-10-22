import { describe, expect, it } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { buildNav } from "../compile/nav.ts";
import { endpointCount, groupTarget, startsOpen } from "../model/nav.ts";
import type { NavItem, PageMeta } from "../model/nav.ts";

type Group = Extract<NavItem, { type: "group" }>;

const OVERVIEW = `---
title: Integrations
---
### Frameworks
<Card title="Mastra" icon="/images/logos/mastra.svg" href="/frameworks/mastra" />
<Card title="Vercel" icon="/images/logos/vercel.svg" href="/frameworks/vercel" />
<Card
  title="OpenAI"
  icon="/images/logos/openai.svg"
  href="/providers/openai-python#setup"
  horizontal
/>
<Card title="Guide" icon="book" href="/frameworks/plain" />
<Card title="Screenshot" icon="/images/screens/plain.png" href="/frameworks/plain" />
`;

function integrationFixture({ root }: { root: string }) {
  return docsFixture({
    config: {
      navigation: {
        anchors: [
          {
            anchor: "Observability",
            groups: [
              {
                group: "Frameworks",
                root,
                expanded: true,
                pages: [
                  "overview",
                  "frameworks/mastra",
                  "frameworks/vercel",
                  "frameworks/plain",
                  {
                    group: "OpenAI",
                    pages: ["providers/openai-python", "providers/openai-go"],
                  },
                  { group: "Python", icon: "python", pages: ["providers/python"] },
                ],
              },
            ],
          },
        ],
      },
    },
    pages: {
      "overview.mdx": OVERVIEW,
      "frameworks/mastra.mdx": "---\ntitle: Mastra\n---",
      "frameworks/vercel.mdx": "---\ntitle: Vercel\n---",
      "frameworks/plain.mdx": "---\ntitle: Plain\n---",
      "providers/openai-python.mdx": "---\ntitle: OpenAI\nicon: python\n---",
      "providers/openai-go.mdx": "---\ntitle: OpenAI Go\n---",
      "providers/python.mdx": "---\ntitle: Python\n---",
    },
  });
}

describe("when integration groups carry roots, expansion and overview card logos", () => {
  it("keeps the authored root and expansion and gives pages their card logo", () => {
    const fixture = integrationFixture({ root: "overview#frameworks" });
    try {
      const nav = buildNav({ docsRoot: fixture.docsRoot });
      const [frameworks] = nav.anchors[0].children as Group[];
      expect(frameworks).toMatchObject({ root: "overview#frameworks", expanded: true });
      expect(nav.pages["frameworks/mastra"].logo).toBe("/images/logos/mastra.svg");
      expect(nav.pages["providers/openai-python"].logo).toBe("/images/logos/openai.svg");
      expect(nav.pages["frameworks/plain"].logo).toBe("");
    } finally {
      fixture.dispose();
    }
  });

  it("links a root page to its heading named like the group, as docs.json cannot", () => {
    const fixture = integrationFixture({ root: "overview" });
    try {
      const nav = buildNav({ docsRoot: fixture.docsRoot });
      const [frameworks] = nav.anchors[0].children as Group[];
      expect(frameworks.root).toBe("overview#frameworks");
    } finally {
      fixture.dispose();
    }
  });

  it("badges a group with the one logo its pages share, and never a mixed category", () => {
    const fixture = integrationFixture({ root: "overview" });
    try {
      const nav = buildNav({ docsRoot: fixture.docsRoot });
      const [frameworks] = nav.anchors[0].children as Group[];
      const [openai, python] = frameworks.children.filter(
        (child): child is Group => child.type === "group",
      );
      expect(frameworks.icon).toBeUndefined();
      expect(openai.icon).toBe("/images/logos/openai.svg");
      expect(python.icon).toBe("python");
    } finally {
      fixture.dispose();
    }
  });

  it("rejects a root that is not a published page", () => {
    const fixture = integrationFixture({ root: "missing#frameworks" });
    try {
      expect(() => buildNav({ docsRoot: fixture.docsRoot })).toThrow(
        expect.objectContaining({ code: "docs_group_root_missing" }),
      );
    } finally {
      fixture.dispose();
    }
  });
});

function meta({ openapi = "" }: { openapi?: string }): PageMeta {
  return {
    title: "",
    description: "",
    sidebarTitle: "",
    openapi,
    mode: "",
    icon: "",
    logo: "",
    updated: "",
    tag: "",
  };
}

function endpointGroup({ size }: { size: number }): {
  group: Group;
  pages: Record<string, PageMeta>;
} {
  const slugs = Array.from({ length: size }, (_, index) => `api/${index}`);
  return {
    group: {
      type: "group",
      title: "Traces",
      children: slugs.map((slug) => ({ type: "page", slug, title: slug })),
    },
    pages: Object.fromEntries(slugs.map((slug) => [slug, meta({ openapi: "GET /traces" })])),
  };
}

describe("which groups start open", () => {
  it("opens small endpoint groups and keeps larger ones closed unless they hold the page", () => {
    const small = endpointGroup({ size: 4 });
    const large = endpointGroup({ size: 5 });
    expect(startsOpen({ ...small, slug: "elsewhere" })).toBe(true);
    expect(startsOpen({ ...large, slug: "elsewhere" })).toBe(false);
    expect(startsOpen({ ...large, slug: "api/3" })).toBe(true);
    expect(endpointCount(large)).toBe(5);
  });

  it("opens authored-expanded and single-page groups, but not small prose groups", () => {
    const pages = { a: meta({}), b: meta({}) };
    const prose: Group = {
      type: "group",
      title: "Guides",
      children: [
        { type: "page", slug: "a", title: "A" },
        { type: "page", slug: "b", title: "B" },
      ],
    };
    expect(startsOpen({ group: prose, slug: "x", pages })).toBe(false);
    expect(startsOpen({ group: { ...prose, expanded: true }, slug: "x", pages })).toBe(true);
    expect(
      startsOpen({ group: { ...prose, children: prose.children.slice(0, 1) }, slug: "x", pages }),
    ).toBe(true);
    expect(endpointCount({ group: prose, pages })).toBe(0);
  });

  it("links a group header to its root, otherwise to its first page", () => {
    const { group } = endpointGroup({ size: 2 });
    expect(groupTarget({ group })).toBe("api/0");
    expect(groupTarget({ group: { ...group, root: "overview#traces" } })).toBe("overview#traces");
  });
});
