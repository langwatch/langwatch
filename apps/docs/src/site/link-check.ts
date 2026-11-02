import { readBuildIndex, servedPath, type BuildIndex } from "./checks/build-index.ts";
import { linkIssue, type LinkIssue } from "./checks/resolve.ts";

export type { LinkIssue } from "./checks/resolve.ts";

const UNCHECKED_SCHEME = /^(mailto:|tel:|data:|javascript:)/i;

/** Media addresses (src, poster, every srcset candidate) that leave a mounted build's prefix. */
function escapedMedia({ media, basePath }: { media: string[]; basePath: string }) {
  if (!basePath) return [];
  return media.filter(
    (address) =>
      address.startsWith("/") && !address.startsWith("//") && !address.startsWith(`${basePath}/`),
  );
}

/** Every local link and fragment in a build's HTML, following redirects; external links pass. */
export function checkHtmlLinks({ index }: { index: BuildIndex }) {
  let checked = 0;
  const issues: LinkIssue[] = [];
  for (const [file, facts] of index.html) {
    const source = servedPath({ outDir: index.outDir, file });
    const escaped = escapedMedia({ media: facts.media, basePath: index.basePath });
    issues.push(...escaped.map((href) => ({ source, href, code: "outside-base-path" })));
    const checkable = facts.hrefs.filter((href) => href && !UNCHECKED_SCHEME.test(href));
    checked += checkable.length + escaped.length;
    for (const href of checkable) {
      const code = linkIssue({ href, source, index });
      if (code) issues.push({ source, href, code });
    }
  }
  return { pages: index.html.size, checked, issues };
}

/** The HTML link check over a build directory. */
export function checkLinks({ outDir, basePath = "" }: { outDir: string; basePath?: string }) {
  return checkHtmlLinks({ index: readBuildIndex({ outDir, basePath }) });
}
