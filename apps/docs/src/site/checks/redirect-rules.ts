import { matchRedirect } from "../../features/navigation/model.ts";
import type { BuildIndex } from "./build-index.ts";
import type { LinkIssue } from "./resolve.ts";

const PARAMETER = /:(\w+)\*?/g;

function parameters({ path }: { path: string }) {
  return new Set([...path.matchAll(PARAMETER)].map((match) => match[1]));
}

/** The issue with one destination, judged on its own: shape, fragment, page and chain. */
function destinationIssue({
  source,
  destination,
  index,
  pages,
}: {
  source: string;
  destination: string;
  index: BuildIndex;
  pages: Set<string>;
}) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) {
    if (!/^https:\/\/[^/?#]+/.test(destination)) return "destination-not-https";
    return null;
  }
  if (!destination.startsWith("/")) return "destination-not-absolute";
  if (destination.includes("#")) return "destination-fragment";
  const sourceParameters = parameters({ path: source });
  const destinationParameters = parameters({ path: destination });
  if (destinationParameters.size > 0)
    return [...destinationParameters].every((name) => sourceParameters.has(name))
      ? null
      : "destination-unknown-parameter";
  const pathname = new URL(destination, "http://docs.local").pathname.replace(/\/$/, "") || "/";
  if (matchRedirect({ path: pathname, redirects: index.redirects }) !== null)
    return "redirect-chain";
  const page = pathname.replace(/\.(md|claude|agent)$/, "").replace(/^\/index$/, "/");
  return pages.has(page) ? null : "destination-not-page";
}

/** Follows a static source until it leaves the redirects; a revisited source is a cycle. */
function hasCycle({ source, index }: { source: string; index: BuildIndex }) {
  const seen = new Set<string>();
  let current: string | null = source;
  while (current !== null && current.startsWith("/")) {
    const pathname = new URL(current, "http://docs.local").pathname.replace(/\/$/, "") || "/";
    if (seen.has(pathname)) return true;
    seen.add(pathname);
    current = matchRedirect({ path: pathname, redirects: index.redirects });
  }
  return false;
}

/** Mintlify's `--check-redirects` and the redirect ledger rules, over the built redirects. */
export function checkRedirectRules({ index }: { index: BuildIndex }) {
  const pages = new Set(index.pages);
  const issues: LinkIssue[] = [];
  for (const [source, destination] of Object.entries(index.redirects)) {
    const report = (code: string) => issues.push({ source, href: destination, code });
    if (!source.startsWith("/")) report("source-not-absolute");
    if (pages.has(source)) report("source-is-page");
    const code = destinationIssue({ source, destination, index, pages });
    if (code) report(code);
    if (!source.includes(":") && hasCycle({ source, index })) report("redirect-cycle");
  }
  return { checked: Object.keys(index.redirects).length, issues };
}
