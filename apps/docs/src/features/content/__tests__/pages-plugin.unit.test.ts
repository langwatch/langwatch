import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docsFixture } from "../../../testing/docs-fixture.ts";
import { buildNav } from "../../navigation/compile/nav.ts";
import { sourceSearchIndex } from "../../search/compile/search-index.ts";
import { reloadDocsSource } from "../compile/pages-plugin.ts";

const CONFIG = {
  navigation: { anchors: [{ anchor: "Docs", groups: [{ group: "Start", pages: ["guide"] }] }] },
};

let fixture: ReturnType<typeof docsFixture>;

beforeEach(() => {
  fixture = docsFixture({
    config: CONFIG,
    pages: { "guide.mdx": "---\ntitle: Guide\n---\nThe first draft." },
  });
});

afterEach(() => fixture.dispose());

/** A dev server holding the docs' virtual modules and one ordinary module. */
function devServer() {
  const ids = ["\0virtual:docs-pages", "\0virtual:docs-nav", "/src/app/main.tsx"];
  const invalidated: string[] = [];
  const sent: unknown[] = [];
  const server = {
    moduleGraph: {
      idToModuleMap: new Map(ids.map((id) => [id, { id }])),
      invalidateModule: (mod: { id: string }) => void invalidated.push(mod.id),
    },
    ws: { send: (payload: { type: "full-reload" }) => void sent.push(payload) },
  };
  return { server, invalidated, sent };
}

function hotUpdate({ file, onSourceChange }: { file: string; onSourceChange: () => void }) {
  const dev = devServer();
  reloadDocsSource({ docsRoot: fixture.docsRoot, file, server: dev.server, onSourceChange });
  return dev;
}

describe("given the development server is running", () => {
  describe("when an MDX page changes", () => {
    /** @scenario "Reload changed source during development" */
    it("invalidates every docs virtual module and reloads the browser", () => {
      const onSourceChange = vi.fn();
      const dev = hotUpdate({ file: path.join(fixture.docsRoot, "guide.mdx"), onSourceChange });
      expect(onSourceChange).toHaveBeenCalledOnce();
      expect(dev.invalidated).toEqual(["\0virtual:docs-pages", "\0virtual:docs-nav"]);
      expect(dev.sent).toEqual([{ type: "full-reload" }]);
    });

    /** @scenario "Reload changed source during development" */
    it("indexes the changed page text for search", () => {
      const docsRoot = fixture.docsRoot;
      writeFileSync(path.join(docsRoot, "guide.mdx"), "---\ntitle: Guide\n---\nThe second draft.");
      const [entry] = sourceSearchIndex({ docsRoot, nav: buildNav({ docsRoot }) });
      expect(entry?.body).toContain("The second draft.");
      expect(entry?.body).not.toContain("The first draft.");
    });
  });

  describe("when a file outside the docs sources changes", () => {
    it("leaves the page modules alone", () => {
      const onSourceChange = vi.fn();
      const dev = hotUpdate({ file: "/elsewhere/notes.mdx", onSourceChange });
      expect(onSourceChange).not.toHaveBeenCalled();
      expect(dev.invalidated).toEqual([]);
      expect(dev.sent).toEqual([]);
    });
  });
});
