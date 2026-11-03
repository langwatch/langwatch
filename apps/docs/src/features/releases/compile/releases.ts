import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { Temporal } from "@langwatch/time";

import { releaseSchema, type Release } from "../model/release.ts";

export const RELEASES_SLUG = "changelog";
const PUBLISHED = 5;
const WHATS_NEW = 3;
/** Under the audit's 8,000 page tokens (budgets.json), with room for the export's own framing. */
export const CHANGELOG_TOKENS = 7_500;
const RELEASES_URL = "https://github.com/langwatch/langwatch/releases";
const WHATS_NEW_TAG = /^<WhatsNew\s*\/>\s*$/m;
const NOTES_TAG = /^<ReleaseNotes\s*\/>\s*$/m;
const cache = new Map<string, { modified: string; entries: Release[] }>();

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

/* "([#12](…)) ([abc1234](…/commit/…))": the pull request already leads to the commit. */
const COMMIT_BESIDE_PULL_REQUEST =
  /(\(\[#\d+\]\([^)\s]+\)\)) \(\[[0-9a-f]{7,40}\]\([^)\s]+\/commit\/[0-9a-f]+\)\)/g;

/** A release's notes without the commit links that repeat a linked pull request. */
function compactNotes({ body }: { body: string }) {
  return body.replace(COMMIT_BESIDE_PULL_REQUEST, "$1");
}

/** The newest well-formed releases; malformed entries are skipped. */
export function parseReleases({ source }: { source: string }): Release[] {
  const headings = [
    ...source.matchAll(/^## \[([^\]]+)\]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)\s*$/gm),
  ];
  return headings
    .flatMap((heading, index) => {
      const [, version, compare, date] = heading;
      if (version === undefined || date === undefined) return [];
      const body = compactNotes({
        body: source
          .slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index)
          .trim(),
      });
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
    .slice(0, PUBLISHED);
}

const escapeMdx = ({ text }: { text: string }) =>
  text.replace(/[{}<>]/g, (character) => `&#${character.charCodeAt(0)};`);

/** A page's `<WhatsNew />` tag as a short list of the newest releases. */
function whatsNew({ entries }: { entries: Release[] }) {
  if (!entries.length) return "";
  const items = entries
    .slice(0, WHATS_NEW)
    .map(
      ({ version, label, summary, href }) =>
        `- [v${version}](${href}) ${label}: ${escapeMdx({ text: summary })}`,
    )
    .join("\n");
  return `## What’s new\n\n<div className="docs-whats-new">\n\n${items}\n\n</div>\n\n[Read the changelog](/${RELEASES_SLUG})\n`;
}

/**
 * The newest releases, each linking to its notes on the changelog page or, when the page has no
 * room for them, to its GitHub release.
 */
export function readReleases({ docsRoot }: { docsRoot: string }) {
  const file = changelogPath({ docsRoot });
  if (!existsSync(file)) return [];
  const page = path.join(docsRoot, `${RELEASES_SLUG}.mdx`);
  const modified = `${statSync(file).mtimeMs}:${existsSync(page) ? statSync(page).mtimeMs : 0}`;
  const cached = cache.get(file);
  if (cached?.modified === modified) return cached.entries;
  const parsed = parseReleases({ source: readFileSync(file, "utf8") });
  const { shown } = existsSync(page)
    ? changelogFit({ source: readFileSync(page, "utf8"), entries: parsed })
    : { shown: parsed.length };
  const entries = parsed.map((entry, index) =>
    index < shown ? entry : { ...entry, href: releaseUrlOf(entry) },
  );
  cache.set(file, { modified, entries });
  return entries;
}

/** Fills the changelog's `<ReleaseNotes />` tag (else its top) and any `<WhatsNew />` tag. */
export function withReleaseNotes({
  source,
  slug,
  docsRoot,
}: {
  source: string;
  slug: string;
  docsRoot: string;
}) {
  if (slug !== RELEASES_SLUG) {
    if (!WHATS_NEW_TAG.test(source)) return source;
    return source.replace(WHATS_NEW_TAG, () => whatsNew({ entries: readReleases({ docsRoot }) }));
  }
  const entries = readReleases({ docsRoot });
  if (!entries.length) return source.replace(NOTES_TAG, "");
  return changelogFit({ source, entries }).page;
}

/** The changelog page with the newest releases that fit its token budget, always the newest. */
function changelogFit({ source, entries }: { source: string; entries: Release[] }) {
  const place = (notes: string) => {
    if (NOTES_TAG.test(source)) return source.replace(NOTES_TAG, () => notes);
    const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0] ?? "";
    return `${frontmatter}\n${notes}\n${source.slice(frontmatter.length)}`;
  };
  const fits = (notes: string) => tokensOf({ text: place(notes) }) <= CHANGELOG_TOKENS;
  const sections = entries.map((entry) => releaseSection({ entry }));
  const [newest] = entries;
  if (!newest) return { page: place(""), shown: 0 };
  if (!fits(sections[0] ?? "")) {
    const room = CHANGELOG_TOKENS * 4 - place("").length;
    return { page: place(releaseSection({ entry: newest, maxLength: room })), shown: 1 };
  }
  let shown = 1;
  for (; shown < sections.length; shown += 1) {
    const wider = sections.slice(0, shown + 1).join("\n");
    if (!fits(wider)) break;
  }
  return { page: place(sections.slice(0, shown).join("\n")), shown };
}

const tokensOf = ({ text }: { text: string }) => Math.ceil(text.length / 4);

/** The GitHub release a changelog entry was tagged as, from the end of its compare link. */
function releaseUrlOf({ compare }: Pick<Release, "compare">) {
  const tag = compare.split("...").at(-1);
  return tag && tag !== compare ? `${RELEASES_URL}/tag/${tag}` : RELEASES_URL;
}

/**
 * One release on the changelog page. With `maxLength`, whole lines of its notes are kept while
 * the section fits, followed by a link to the full notes on its release page.
 */
function releaseSection({ entry, maxLength }: { entry: Release; maxLength?: number }) {
  const { version, label, body, compare } = entry;
  const heading = `## Release v${version}\n\nReleased ${label}. [Compare changes](${compare}).\n\n`;
  const notes = escapeMdx({ text: body });
  if (maxLength === undefined) return `${heading}${notes}\n`;
  const more = `\n\n[Read the full notes](${releaseUrlOf({ compare })}).\n`;
  const kept: string[] = [];
  let length = heading.length + more.length;
  for (const line of notes.split("\n")) {
    if (length + line.length + 1 > maxLength) break;
    kept.push(line);
    length += line.length + 1;
  }
  return `${heading}${kept.join("\n").trimEnd()}${more}`;
}
