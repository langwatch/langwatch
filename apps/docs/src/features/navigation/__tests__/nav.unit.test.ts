import { describe, expect, it } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { buildNav, openapiPages } from "../compile/nav.ts";

describe("when navigation lists nested groups and API pages", () => {
  /** @scenario "Preserve authored navigation and API slugs" */
  it("keeps authored ordering, titles and slugs and excludes unlisted files", () => {
    const fixture = docsFixture({
      config: {
        navigation: {
          anchors: [
            {
              anchor: "Platform",
              icon: "book",
              groups: [
                {
                  group: "Start",
                  pages: ["guide", { group: "API", pages: ["api/read", "api/write"] }],
                },
              ],
            },
          ],
          global: { anchors: [{ anchor: "Support", href: "https://example.com/help" }] },
        },
      },
      pages: {
        "guide.mdx": "---\ntitle: First steps\nsidebarTitle: Start here\n---\nHello",
        "api/read.mdx": "---\nopenapi: GET /traces/{id}\n---",
        "api/write.mdx": "---\ntitle: Publish trace\nopenapi: POST /traces\n---",
        "api/admin.mdx": "---\nopenapi: DELETE /admin\n---",
      },
      main: {
        paths: {
          "/traces/{id}": { get: { summary: "Read a trace", responses: {} } },
          "/traces": { post: { operationId: "postApiTrace", responses: {} } },
          "/admin": { delete: { summary: "Internal", responses: {} } },
        },
      },
    });
    try {
      const nav = buildNav({ docsRoot: fixture.docsRoot });
      expect(Object.keys(nav.pages)).toEqual(["guide", "api/read", "api/write"]);
      expect(nav.anchors).toEqual([
        {
          title: "Platform",
          icon: "book",
          children: [
            {
              type: "group",
              title: "Start",
              children: [
                { type: "page", slug: "guide", title: "Start here" },
                {
                  type: "group",
                  title: "API",
                  children: [
                    { type: "page", slug: "api/read", title: "Read a trace" },
                    { type: "page", slug: "api/write", title: "Publish trace" },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      expect(openapiPages({ docsRoot: fixture.docsRoot })).toEqual({
        "api/read": "GET /traces/{id}",
        "api/write": "POST /traces",
      });
      expect(nav.support).toEqual([
        { title: "Support", icon: "", href: "https://example.com/help" },
      ]);
    } finally {
      fixture.dispose();
    }
  });
});

describe("when a configured page is missing", () => {
  /** @scenario "Reject a missing configured source" */
  it("fails instead of silently reducing the published inventory", () => {
    const fixture = docsFixture({
      config: { navigation: { anchors: [{ anchor: "Docs", pages: ["missing"] }] } },
    });
    try {
      expect(() => buildNav({ docsRoot: fixture.docsRoot })).toThrow(
        expect.objectContaining({ code: "docs_page_missing" }),
      );
    } finally {
      fixture.dispose();
    }
  });
});
