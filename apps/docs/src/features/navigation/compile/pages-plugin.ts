import path from "node:path";

import type { Plugin } from "vite";

import { changelogPath } from "../../releases/compile.ts";
import { buildNav } from "./nav.ts";

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
          return `${jsString(slug)}: () => import(${jsString(file)})`;
        });
        return `export default {${entries.join(",")}};`;
      },
    },
    handleHotUpdate({ file, server }) {
      reloadDocsSource({ docsRoot, file, server, onSourceChange });
    },
  };
}

/** A string literal safe anywhere in generated JavaScript, even beside `</script>`. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(
    /[<>/\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The part of the dev server a source reload touches. */
type ReloadServer<Module> = {
  moduleGraph: {
    idToModuleMap: Map<string, Module>;
    invalidateModule: (mod: Module) => void;
  };
  ws: { send: (payload: { type: "full-reload" }) => void };
};

/** Invalidates every docs virtual module and reloads the browser when a docs source changes. */
export function reloadDocsSource<Module>({
  docsRoot,
  file,
  server,
  onSourceChange,
}: {
  docsRoot: string;
  file: string;
  server: ReloadServer<Module>;
  onSourceChange: () => void;
}) {
  if (!file.startsWith(docsRoot + path.sep) && file !== changelogPath({ docsRoot })) return;
  onSourceChange();
  for (const [id, mod] of server.moduleGraph.idToModuleMap) {
    if (id.startsWith("\0virtual:docs-")) server.moduleGraph.invalidateModule(mod);
  }
  server.ws.send({ type: "full-reload" });
}
