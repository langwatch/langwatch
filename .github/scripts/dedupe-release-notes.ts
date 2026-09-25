#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Squash merges here carry COMMIT_MESSAGES, so a pull request whose commit
// body opens with its own conventional-commit line parses as TWO release-note
// entries against ONE sha: the subject entry carries the pull-request link,
// the body entry does not. Release Please writes both, and #7206 shows the
// pairs landing in every released section. This pass removes them again.
//
// It runs AFTER Release Please in release-please-sdks.yml over each release
// branch's changelogs, so what a release PR merges is already deduplicated.
// The keeper is deterministic: an entry naming the pull request GitHub says
// merged the commit, else any pull-request-linked entry, else the first.

/** A trailing commit link, as Release Please renders it: `([abc1234](…/commit/<sha>))`. */
const shaPattern = /\]\((https:\/\/[^)\s]*\/commit\/([0-9a-f]{7,40}))\)/;

/** A linked pull request number, as Release Please renders issue redirects: `([#123](…/issues/123))`. */
const prLinkPattern = /https:\/\/[^)\s]*\/issues\/(\d+)/;

export const extractSha = (line: string): string | null =>
  shaPattern.exec(line)?.[2] ?? null;

export const extractPrNumbers = (line: string): number[] =>
  [...line.matchAll(new RegExp(prLinkPattern.source, "g"))].map(
    (match) => Number(match[1]),
  );

export type DedupeOptions = {
  /**
   * Asks GitHub which pull requests one commit merged. Omitted in tests and
   * offline runs; the keeper falls back to any pull-request-linked entry.
   */
  resolveMergedPrs?: (sha: string) => Promise<number[]>;
};

/**
 * Removes duplicated release-note entries: within one version section, at
 * most one bullet per commit sha survives. Every non-bullet line, and bullets
 * without a duplicate, survive byte for byte.
 */
export const dedupeChangelog = async (
  content: string,
  options: DedupeOptions = {},
): Promise<string> => {
  const lines = content.split("\n");
  // Section boundaries are the `## [` version headings; a bullet belongs to
  // the section open where it sits, so the same sha can never be deduped
  // across versions. Every section's surplus indices are collected before any
  // removal, because removing as we go would shift the later sections'
  // positions under our feet.
  const drop = new Set<number>();

  let sectionStart = 0;
  while (sectionStart < lines.length) {
    if (!/^## /.test(lines[sectionStart] ?? "")) {
      sectionStart += 1;
      continue;
    }

    let cursor = sectionStart + 1;
    while (cursor < lines.length && !/^## /.test(lines[cursor] ?? "")) {
      cursor += 1;
    }
    await markSurplus(lines, sectionStart + 1, cursor, options, drop);
    sectionStart = cursor;
  }

  if (drop.size === 0) return content;

  // Descending: each removal would shift every later index.
  for (const index of [...drop].sort((a, b) => b - a)) {
    lines.splice(index, 1);
  }
  return lines.join("\n");
};

/**
 * Adds to `drop` every bullet index inside `[begin, end)` beyond the one
 * keeper per duplicated sha.
 */
const markSurplus = async (
  lines: string[],
  begin: number,
  end: number,
  options: DedupeOptions,
  drop: Set<number>,
): Promise<void> => {
  const bullets = new Map<string, number[]>();
  for (let i = begin; i < end; i += 1) {
    const sha = extractSha(lines[i] ?? "");
    if (!sha) continue;
    const seen = bullets.get(sha) ?? [];
    seen.push(i);
    bullets.set(sha, seen);
  }

  for (const [sha, at] of [...bullets.entries()].filter(
    ([, seen]) => seen.length > 1,
  )) {
    const entries = at.map((i) => ({
      index: i,
      prNumbers: extractPrNumbers(lines[i] ?? ""),
    }));

    const merged = (await options.resolveMergedPrs?.(sha)) ?? [];
    const mergedHere = entries.filter((entry) =>
      entry.prNumbers.some((number) => merged.includes(number)),
    );
    const linked = entries.filter((entry) => entry.prNumbers.length > 0);

    const keeper = mergedHere[0] ?? linked[0] ?? entries[0];
    for (const entry of entries) {
      if (entry !== keeper) drop.add(entry.index);
    }
  }
};

/**
 * Which pull request a commit merged, through the association API: a squash
 * merge associates exactly the pull request that was merged, which is how two
 * entries naming two different numbers (#7346/#7347 in 3.16.0) get told apart.
 * Unavailable without credentials; the caller degrades to link-preference.
 */
export const githubMergedPrs = (): ((sha: string) => Promise<number[]>) | undefined => {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return undefined;

  return async (sha: string): Promise<number[]> => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/commits/${sha}/pulls`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) return [];
    const pulls = (await response.json()) as { number?: number }[];
    return pulls.flatMap((pull) =>
      typeof pull.number === "number" ? [pull.number] : [],
    );
  };
};

const main = async (): Promise<number> => {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: dedupe-release-notes.ts <changelog-path> [...]");
    return 2;
  }

  const resolveMergedPrs = githubMergedPrs();
  for (const path of paths) {
    const before = readFileSync(resolve(path), "utf8");
    const after = await dedupeChangelog(before, { resolveMergedPrs });
    if (before === after) {
      console.log(`${path}: no duplicate entries`);
      continue;
    }
    writeFileSync(resolve(path), after);
    console.log(`${path}: removed duplicate entries`);
  }
  return 0;
};

const isEntrypoint = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  await main().then((code) => {
    process.exitCode = code;
  });
}
