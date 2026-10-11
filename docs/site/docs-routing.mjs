import { readFileSync } from "node:fs";
import path from "node:path";

export function readRedirects({ docsRoot }) {
  const config = JSON.parse(readFileSync(path.join(docsRoot, "docs.json"), "utf8"));
  return Object.fromEntries(
    (config.redirects ?? []).map(({ source, destination }) => [
      source.replace(/\/$/, ""),
      destination,
    ]),
  );
}

export function resolveRedirect({ pathname, search, redirects }) {
  const destination = redirects[pathname.replace(/\/$/, "")];
  if (!destination) return null;
  const target = new URL(destination, "http://docs.local");
  for (const [key, value] of new URLSearchParams(search)) {
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  }
  if (/^https?:\/\//.test(destination)) return target.href;
  return `${target.pathname}${target.search}${target.hash}`;
}
