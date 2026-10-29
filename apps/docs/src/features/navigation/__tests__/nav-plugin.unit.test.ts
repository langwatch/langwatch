import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { docsNavPlugin } from "../compile/nav-plugin.ts";

vi.mock("../compile/github-stars.ts", () => ({ readStars: async () => null }));

let fixture: ReturnType<typeof docsFixture>;

beforeEach(() => {
  fixture = docsFixture({
    config: {
      navigation: { anchors: [{ anchor: "Docs", groups: [{ group: "Start", pages: ["guide"] }] }] },
    },
    pages: {
      "guide.mdx": "---\ntitle: Guide\n---\nHello",
      "api/read.mdx": "---\nopenapi: GET /traces\n---",
    },
    main: { paths: { "/traces": { get: { summary: "Read traces", responses: {} } } } },
  });
});

afterEach(() => fixture.dispose());

async function loadNav() {
  const plugin = docsNavPlugin({ docsRoot: fixture.docsRoot });
  const load = plugin.load;
  if (!load || typeof load === "function") throw new Error("docs-nav has no filtered load hook");
  const watched: string[] = [];
  const code = await load.handler.call(
    { addWatchFile: (file: string) => watched.push(file) } as never,
    "\0virtual:docs-nav",
  );
  if (typeof code !== "string") throw new Error("docs-nav returned no module source");
  const nav = JSON.parse(code.replace(/^export default /, "").replace(/;$/, ""));
  return { watched, nav };
}

describe("given the development server is running", () => {
  describe("when docs.json or an OpenAPI document changes", () => {
    /** @scenario "Reload navigation and API definitions" */
    it("watches docs.json and every OpenAPI document", async () => {
      const { watched } = await loadNav();
      expect(watched).toEqual(
        expect.arrayContaining([
          path.join(fixture.docsRoot, "docs.json"),
          path.join(fixture.docsRoot, "api-reference/openapiLangWatch.json"),
          path.join(fixture.docsRoot, "api-reference/openapi-evals.json"),
        ]),
      );
    });

    /** @scenario "Reload navigation and API definitions" */
    it("serves navigation and API pages from the changed source", async () => {
      expect(Object.keys((await loadNav()).nav.pages)).toEqual(["guide"]);
      writeFileSync(
        path.join(fixture.docsRoot, "docs.json"),
        JSON.stringify({
          navigation: {
            anchors: [
              { anchor: "Docs", groups: [{ group: "Start", pages: ["guide", "api/read"] }] },
            ],
          },
        }),
      );
      const { nav } = await loadNav();
      expect(Object.keys(nav.pages)).toEqual(["guide", "api/read"]);
      expect(nav.pages["api/read"].title).toBe("Read traces");
    });
  });
});
