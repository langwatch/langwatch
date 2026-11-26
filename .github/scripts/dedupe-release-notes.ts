#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Release Please parses a squash commit's subject and each conventional-commit line in its body,
// so one sha can yield two release-note entries. This pass, run after Release Please in
// release-please-sdks.yml, keeps one: the entry naming the pull request GitHub says merged the
// commit, else any pull-request-linked entry, else the first.
// Spec: specs/ci/release-notes-dedupe.feature

/** A trailing commit link, as Release Please renders it: `([abc1234](…/commit/<sha>))`. */
const shaPattern = /\(\[[0-9a-f]{7,40}\]\((https:\/\/[^)\s]*\/commit\/([0-9a-f]{7,40}))\)\)\s*$/;

/** A top-level release-note bullet: Release Please writes `* `, a formatted changelog `- `. */
const bulletPattern = /^[*-] /;

/** A linked pull request number, as Release Please renders it: `([#123](…/issues/123))`. */
const prLinkPattern = /https:\/\/[^)\s]*\/issues\/(\d+)/;

/** The commit sha of a release-note bullet; null for any other line, even one linking a commit. */
export const extractSha = (line: string): string | null =>
  bulletPattern.test(line) ? (shaPattern.exec(line)?.[2] ?? null) : null;

export const extractPrNumbers = (line: string): number[] =>
  [...line.matchAll(new RegExp(prLinkPattern.source, "g"))].map((match) => Number(match[1]));

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
    if (!(lines[sectionStart] ?? "").startsWith("## ")) {
      sectionStart += 1;
      continue;
    }

    let cursor = sectionStart + 1;
    while (cursor < lines.length && !(lines[cursor] ?? "").startsWith("## ")) {
      cursor += 1;
    }
    await markSurplus(lines, sectionStart + 1, cursor, options, drop);
    sectionStart = cursor;
  }

  if (drop.size === 0) return content;

  // Descending: each removal would shift every later index.
  for (const index of [...drop].toSorted((a, b) => b - a)) {
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

  for (const [sha, at] of [...bullets.entries()].filter(([, seen]) => seen.length > 1)) {
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
 * Which pull requests a commit merged, through the association API, which tells apart two
 * entries naming different numbers. Undefined without credentials (link preference then).
 */
export const githubMergedPrs = (): ((sha: string) => Promise<number[]>) | undefined => {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return undefined;

  return async (sha: string): Promise<number[]> => {
    try {
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
      return Array.isArray(pulls)
        ? pulls.flatMap((pull) => (typeof pull.number === "number" ? [pull.number] : []))
        : [];
    } catch (error) {
      // A lookup that fails degrades to link preference instead of failing the pass.
      console.warn(`could not resolve the pull request for ${sha}: ${String(error)}`);
      return [];
    }
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
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint()) {
  await main().then((code) => {
    process.exitCode = code;
  });
}
