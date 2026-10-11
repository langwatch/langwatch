import path from "node:path";

import { buildNav } from "./docs-nav.mjs";
import { changelogPath } from "./docs-releases.mjs";

const ID = "virtual:docs-pages";

export function docsPagesPlugin({ docsRoot, onSourceChange }) {
  return {
    name: "docs-pages",
    resolveId(id) {
      return id === ID ? `\0${ID}` : null;
    },
    load(id) {
      if (id !== `\0${ID}`) return null;
      const { pages } = buildNav({ docsRoot });
      const entries = Object.keys(pages).map((slug) => {
        const file = path.join(docsRoot, `${slug}.mdx`);
        this.addWatchFile(file);
        return `${JSON.stringify(slug)}: () => import(${JSON.stringify(file)})`;
      });
      return `export default {${entries.join(",")}};`;
    },
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(docsRoot + path.sep) && file !== changelogPath({ docsRoot })) return;
      if (file.includes(`${path.sep}site${path.sep}`)) return;
      onSourceChange();
      for (const [id, mod] of server.moduleGraph.idToModuleMap) {
        if (id.startsWith("\0virtual:docs-")) server.moduleGraph.invalidateModule(mod);
      }
      server.ws.send({ type: "full-reload" });
    },
  };
}
