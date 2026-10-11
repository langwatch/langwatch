import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { Temporal } from "@langwatch/time";

import { releaseSchema, type Release } from "../model/release.ts";

export const RELEASES_SLUG = "self-hosting/releases";
const cache = new Map<string, { modified: number; entries: Release[] }>();

/** The repository CHANGELOG.md beside the docs root. */
export function changelogPath({ docsRoot }: { docsRoot: string }) {
  return path.resolve(docsRoot, "../CHANGELOG.md");
}

function summaryOf({ body }: { body: string }) {
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

/** The two newest well-formed releases; malformed entries are skipped. */
export function parseReleases({ source }: { source: string }): Release[] {
  const headings = [
    ...source.matchAll(/^## \[([^\]]+)\]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)\s*$/gm),
  ];
  return headings
    .flatMap((heading, index) => {
      const [, version, compare, date] = heading;
      const body = source
        .slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index)
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
          label: Temporal.PlainDate.from(date).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        },
      ];
    })
    .slice(0, 2);
}

export function readReleases({ docsRoot }: { docsRoot: string }) {
  const file = changelogPath({ docsRoot });
  if (!existsSync(file)) return [];
  const modified = statSync(file).mtimeMs;
  const cached = cache.get(file);
  if (cached?.modified === modified) return cached.entries;
  const entries = parseReleases({ source: readFileSync(file, "utf8") });
  cache.set(file, { modified, entries });
  return entries;
}

/** Injects the newest releases above the authored releases page; other pages pass through. */
export function withReleaseNotes({
  source,
  slug,
  docsRoot,
}: {
  source: string;
  slug: string;
  docsRoot: string;
}) {
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
