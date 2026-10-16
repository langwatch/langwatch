import { describe, expect, it } from "vitest";

import { searchEntry, searchTrail } from "../compile/search-index.ts";

describe("when a rendered page includes shell text and nested navigation", () => {
  /** @scenario "Index API reference content" */
  it("indexes endpoint main content when there is no guide article", () => {
    const entry = searchEntry({
      nav: {
        pages: {
          endpoint: { title: "List prompts", description: "Read prompts", openapi: "GET /prompts" },
        },
        anchors: [],
      },
      slug: "endpoint",
      html: '<nav>Unrelated navigation</nav><main id="content"><h1>List prompts</h1><p>GET /prompts</p><section>cursor query parameter</section><section>promptVersion response field</section></main><footer>Unrelated footer</footer>',
      headings: [],
    });
    expect(entry.body).toBe(
      "List prompts GET /prompts cursor query parameter promptVersion response field",
    );
    expect(entry.method).toBe("GET");
  });

  /** @scenario "Index article content with navigation context" */
  it("indexes the article and heading anchors with the authored context", () => {
    const nav = {
      pages: { guide: { title: "Trace guide", description: "Record a trace" } },
      anchors: [
        {
          title: "Observability",
          children: [
            {
              type: "group",
              title: "SDKs",
              children: [{ type: "page", slug: "guide", title: "Trace guide" }],
            },
          ],
        },
      ],
    } satisfies Parameters<typeof searchEntry>[0]["nav"];
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
