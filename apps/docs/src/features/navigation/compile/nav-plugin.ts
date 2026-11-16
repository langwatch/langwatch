import path from "node:path";

import type { Plugin } from "vite";

import { SPEC_FILES } from "../../api-reference/compile.ts";
import { changelogPath } from "../../releases/compile.ts";
import { readStars as readGitHubStars, type StarsRead } from "./github-stars.ts";
import { buildNav } from "./nav.ts";

const VIRTUAL_ID = "virtual:docs-nav";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Serves `virtual:docs-nav`, watching every source the navigation is compiled from. */
export function docsNavPlugin({
  docsRoot,
  readStars = readGitHubStars,
}: {
  docsRoot: string;
  /** Where the star count comes from; tests pass their own so they never reach GitHub. */
  readStars?: () => Promise<StarsRead>;
}): Plugin {
  return {
    name: "docs-nav",
    resolveId: {
      filter: { id: new RegExp(`^${VIRTUAL_ID}$`) },
      handler: () => RESOLVED_ID,
    },
    load: {
      filter: { id: new RegExp(`^\0${VIRTUAL_ID}$`) },
      async handler() {
        this.addWatchFile(path.join(docsRoot, "docs.json"));
        this.addWatchFile(changelogPath({ docsRoot }));
        const nav = buildNav({ docsRoot });
        for (const slug of Object.keys(nav.pages))
          this.addWatchFile(path.join(docsRoot, `${slug}.mdx`));
        for (const file of SPEC_FILES) this.addWatchFile(path.join(docsRoot, file));
        const stars = await readStars();
        nav.site.stars = stars.count;
        nav.site.starsReadAt = stars.at;
        return `export default ${JSON.stringify(nav)};`;
      },
    },
  };
}
