import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { releaseSchema } from "./src/lib/release.ts";

export const RELEASES_SLUG = "self-hosting/releases";
const cache = new Map();

export function changelogPath({ docsRoot }) {
  return path.resolve(docsRoot, "../CHANGELOG.md");
}

function summaryOf({ body }) {
  const section =
    body.split(/^### /m).find((part) => /^(Features|Bug Fixes)\s*\n/.test(part)) ?? body;
  return (section.match(/^\* (.+)$/m)?.[1] ?? "")
    .replace(/^(?:\*\*[^*]+:\*\*|\*\*[^*]+\*\*:)\s*/, "")
    .replace(/\s+\(\[.*$/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .trim()
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

export function parseReleases({ source }) {
  const headings = [
    ...source.matchAll(/^## \[([^\]]+)\]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)\s*$/gm),
  ];
  return headings
    .flatMap((heading, index) => {
      const [, version, compare, date] = heading;
      const body = source
        .slice(heading.index + heading[0].length, headings[index + 1]?.index)
        .trim();
      const result = releaseSchema.safeParse({
        version,
        compare,
        date,
        body,
        label: date,
        summary: summaryOf({ body }),
        href: `/${RELEASES_SLUG}#release-v${version.replaceAll(".", "")}`,
      });
      if (!result.success) return [];
      return [
        {
          ...result.data,
          label: new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(date)),
        },
      ];
    })
    .slice(0, 2);
}

export function readReleases({ docsRoot }) {
  const file = changelogPath({ docsRoot });
  if (!existsSync(file)) return [];
  const modified = statSync(file).mtimeMs;
  const cached = cache.get(file);
  if (cached?.modified === modified) return cached.entries;
  const entries = parseReleases({ source: readFileSync(file, "utf8") });
  cache.set(file, { modified, entries });
  return entries;
}

export function withReleaseNotes({ source, slug, docsRoot }) {
  if (slug !== RELEASES_SLUG) return source;
  const entries = readReleases({ docsRoot });
  if (!entries.length) return source;
  const notes = entries
    .map(
      ({ version, label, body, compare }) =>
        `## Release v${version}\n\nReleased ${label}. [Compare changes](${compare}).\n\n${body.replace(/[{}<>]/g, (character) => `&#${character.charCodeAt(0)};`)}\n`,
    )
    .join("\n");
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0] ?? "";
  return `${frontmatter}\n${notes}\n${source.slice(frontmatter.length)}`;
}
