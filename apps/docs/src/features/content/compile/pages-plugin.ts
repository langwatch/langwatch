import path from "node:path";

import type { Plugin } from "vite";

import { buildNav } from "../../navigation/compile/nav.ts";
import { changelogPath } from "../../releases/compile/releases.ts";

const ID = "virtual:docs-pages";

/** Serves `virtual:docs-pages`, one lazy MDX import per page; dev reloads on source edits. */
export function docsPagesPlugin({
  docsRoot,
  onSourceChange,
}: {
  docsRoot: string;
  onSourceChange: () => void;
}): Plugin {
  return {
    name: "docs-pages",
    resolveId: { filter: { id: new RegExp(`^${ID}$`) }, handler: () => `\0${ID}` },
    load: {
      filter: { id: new RegExp(`^\0${ID}$`) },
      handler() {
        const { pages } = buildNav({ docsRoot });
        const entries = Object.keys(pages).map((slug) => {
          const file = path.join(docsRoot, `${slug}.mdx`);
          this.addWatchFile(file);
          return `${JSON.stringify(slug)}: () => import(${JSON.stringify(file)})`;
        });
        return `export default {${entries.join(",")}};`;
      },
    },
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(docsRoot + path.sep) && file !== changelogPath({ docsRoot })) return;
      onSourceChange();
      for (const [id, mod] of server.moduleGraph.idToModuleMap) {
        if (id.startsWith("\0virtual:docs-")) server.moduleGraph.invalidateModule(mod);
      }
      server.ws.send({ type: "full-reload" });
    },
  };
}
