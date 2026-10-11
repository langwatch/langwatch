import { describe, expect, it } from "vitest";

import { searchEntry, searchTrail } from "../docs-search.mjs";

describe("when a rendered page includes shell text and nested navigation", () => {
  /** @scenario "Index article content with navigation context" */
  it("indexes the article and heading anchors with the authored context", () => {
    const nav = {
      pages: { guide: { title: "Trace guide", description: "Record a trace" } },
      anchors: [
        {
          title: "Observability",
          children: [{ type: "group", title: "SDKs", children: [{ type: "page", slug: "guide" }] }],
        },
      ],
    };
    const entry = searchEntry({
      nav,
      slug: "guide",
      html: '<nav>Not searchable</nav><article class="prose"><style>.hidden { color: red }</style><h2 id="python">Python SDK</h2><p>Capture &amp; inspect <code>spans</code>.</p></article><aside>More shell</aside>',
      headings: [{ id: "python", text: "Python SDK", depth: 2 }],
    });
    expect(entry).toEqual({
      slug: "guide",
      title: "Trace guide",
      description: "Record a trace",
      section: "Observability",
      trail: "Observability › SDKs",
      body: "Python SDK Capture inspect spans .",
      headings: [{ id: "python", text: "Python SDK" }],
    });
    expect(searchTrail({ nav, slug: "unlisted" })).toEqual({ section: "", trail: "" });
  });
});
