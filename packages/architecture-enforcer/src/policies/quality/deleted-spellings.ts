import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { z } from "zod";

import type { ArchitectureViolation } from "../../types.ts";
import { getAnchor } from "../../workspace/anchors.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { isDeletionNote, markdownContextUnits, unitAt } from "./deletion-context.ts";

/**
 * ARCHITECTURE.md §15's deleted spellings, read from dev/docs/deleted-spellings.json. Teaching
 * surfaces may name one only in a deletion note; code is held to today's per-spelling count by the
 * shrink-only list tests/baselines/deleted-spellings.json (§17), which this policy never reads.
 */

export const DELETED_SPELLINGS_LIST = "dev/docs/deleted-spellings.json";
export const DELETED_SPELLINGS_RATCHET =
  "packages/architecture-enforcer/tests/baselines/deleted-spellings.json";
export const TEACHING_POLICY = "deleted-spellings-in-teaching";
export const CODE_POLICY = "deleted-spellings-in-code";

const deletedSpelling = z
  .object({
    spelling: z.string().min(1),
    kind: z.enum(["identifier", "call", "package", "file", "prose"]),
    pattern: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    replacement: z.string().min(1),
    section: z.string().min(1),
    ruled: z.string().nullable(),
    note: z.string().min(1).optional(),
  })
  .refine((entry) => (entry.kind === "prose") === (entry.pattern === undefined), {
    message: "a prose entry has no pattern, and every other kind has one",
  })
  .refine((entry) => entry.kind !== "prose" || entry.note !== undefined, {
    message: "a prose entry says in its note why it has no matcher",
  })
  .refine((entry) => (entry.kind === "file") === (entry.path !== undefined), {
    message: "a file entry, and only a file entry, names a path pattern",
  });

const deletedSpellingList = z.object({
  record: z.string().min(1),
  listed: z.string().min(1),
  spellings: z.array(deletedSpelling).min(1),
});

export type DeletedSpelling = z.infer<typeof deletedSpelling>;

export function readDeletedSpellings({
  root,
  policy,
}: {
  root: string;
  policy: string;
}): DeletedSpelling[] {
  const file = getAnchor({ root, anchor: DELETED_SPELLINGS_LIST, policy });

  return deletedSpellingList.parse(JSON.parse(readFileSync(file, "utf8"))).spellings;
}

type Matcher = { text: RegExp; entries: readonly DeletedSpelling[] };
type Match = { entry: DeletedSpelling; offset: number };

/** One alternation over every pattern, one named group per entry: one pass per file. */
function matcherOf(spellings: readonly DeletedSpelling[]): Matcher {
  const entries = spellings.filter((entry) => entry.pattern !== undefined);
  const source = entries.map((entry, index) => `(?<s${index}>${entry.pattern})`).join("|");

  return { text: new RegExp(source, "g"), entries };
}

function matchesIn({ matcher, source }: { matcher: Matcher; source: string }): Match[] {
  const found: Match[] = [];
  if (matcher.entries.length === 0) return found;

  for (const match of source.matchAll(matcher.text)) {
    const groups = match.groups ?? {};
    const index = matcher.entries.findIndex((_, at) => groups[`s${at}`] !== undefined);
    if (index >= 0) found.push({ entry: matcher.entries[index]!, offset: match.index });
  }

  return found;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = source.indexOf("\n"); at >= 0; at = source.indexOf("\n", at + 1))
    starts.push(at + 1);

  return starts;
}

function lineOf({ starts, offset }: { starts: readonly number[]; offset: number }): number {
  let low = 0;
  let high = starts.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }

  return low + 1;
}

function named(entry: DeletedSpelling): string {
  return entry.spelling.includes("`") ? entry.spelling : `\`${entry.spelling}\``;
}

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

const MARKDOWN = /\.(?:md|mdx|mdc)$/;
const TEACHING_DIRECTORIES = [".claude/rules", ".claude/skills", "dev/docs"] as const;
const TEACHING_EXCLUDED = /^dev\/docs\/(?:adr|plans|reports)\//;
const TEACHING_FILES = ["CLAUDE.md"] as const;

/** CLAUDE.md, .claude/rules, .claude/skills and dev/docs outside adr/, plans/ and dated reports/: Markdown only. */
export function teachingSurfaces(snapshot: WorkspaceSnapshot): string[] {
  const { root } = snapshot;
  const found = TEACHING_FILES.map((file) => join(root, file)).filter((file) => existsSync(file));

  for (const directory of TEACHING_DIRECTORIES) {
    const files = snapshot.files({
      directory: join(root, directory),
      accept: (path) => MARKDOWN.test(path),
    });
    found.push(...files.filter((file) => !TEACHING_EXCLUDED.test(workspacePath({ root, file }))));
  }

  return found;
}

/** Every deleted spelling a teaching surface names outside a deletion note. */
export function lintDeletedSpellingsInTeaching(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { root } = snapshot;
  const matcher = matcherOf(readDeletedSpellings({ root, policy: TEACHING_POLICY }));
  const violations: ArchitectureViolation[] = [];

  for (const file of teachingSurfaces(snapshot)) {
    const source = readFileSync(file, "utf8");
    const matches = matchesIn({ matcher, source });
    if (matches.length === 0) continue;

    const units = markdownContextUnits(source);
    const starts = lineStarts(source);

    for (const { entry, offset } of matches) {
      if (unitAt({ units, offset })?.deletion === true) continue;
      violations.push({
        policy: TEACHING_POLICY,
        file: workspacePath({ root, file }),
        line: lineOf({ starts, offset }),
        specifier: entry.spelling,
        message: `This page teaches ${named(entry)}, a spelling ARCHITECTURE.md §15 deletes (${entry.section}); an agent reading it will write the deleted shape.`,
        allowed: `Rewrite the sentence to teach ${entry.replacement}. If the sentence is about the deletion, say so in it ("deleted", "never write", "§15") and it passes. The list is ${DELETED_SPELLINGS_LIST}.`,
      });
    }
  }

  return violations;
}

const CODE_DIRECTORIES = ["modules", "enterprise", "packages", "apps"] as const;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json)$/;
/** Generated output repeats its source, which is where the spelling is counted. */
const GENERATED = /(?:^|\/)generated\/|\.generated\./;

function codeViolation({
  entry,
  file,
  line,
}: {
  entry: DeletedSpelling;
  file: string;
  line?: number;
}): ArchitectureViolation {
  return {
    policy: CODE_POLICY,
    file,
    ...(line === undefined ? {} : { line }),
    specifier: entry.spelling,
    message: `${named(entry)} is deleted (ARCHITECTURE.md §15, ${entry.section}): an existing use is conversion debt and a new one is a defect.`,
    allowed: `Write ${entry.replacement}. Each spelling's count in ${DELETED_SPELLINGS_RATCHET} may fall, never rise: lower it in the change that removes a use.`,
  };
}

/** Each deleted spelling in modules, enterprise, packages and apps; a file kind counts per file. */
export function lintDeletedSpellingsInCode(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const spellings = readDeletedSpellings({ root, policy: CODE_POLICY });
  const matcher = matcherOf(spellings.filter((entry) => entry.kind !== "file"));
  const files = spellings.flatMap((entry) =>
    entry.path === undefined ? [] : [{ entry, path: new RegExp(entry.path) }],
  );
  const violations: ArchitectureViolation[] = [];

  for (const directory of CODE_DIRECTORIES) {
    for (const file of snapshot.files({ directory: join(root, directory), accept: () => true })) {
      const path = workspacePath({ root, file });
      for (const { entry } of files.filter((candidate) => candidate.path.test(path))) {
        violations.push(codeViolation({ entry, file: path }));
      }
      if (!CODE_FILE.test(path) || GENERATED.test(path) || path === DELETED_SPELLINGS_RATCHET)
        continue;
      violations.push(...codeMatches({ matcher, file, path }));
    }
  }

  return violations;
}

function codeMatches({
  matcher,
  file,
  path,
}: {
  matcher: Matcher;
  file: string;
  path: string;
}): ArchitectureViolation[] {
  const source = readFileSync(file, "utf8");
  const matches = matchesIn({ matcher, source });
  if (matches.length === 0) return [];

  const starts = lineStarts(source);

  return matches.flatMap(({ entry, offset }) => {
    const line = lineOf({ starts, offset });
    const text = source.slice(starts[line - 1], starts[line] ?? source.length);

    return isDeletionNote(text) ? [] : [codeViolation({ entry, file: path, line })];
  });
}

/** Each spelling's count in code: the key the shrink-only list holds. */
export function countDeletedSpellingsInCode(snapshot: WorkspaceSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { specifier } of lintDeletedSpellingsInCode(snapshot)) {
    if (specifier !== undefined) counts.set(specifier, (counts.get(specifier) ?? 0) + 1);
  }

  return counts;
}
