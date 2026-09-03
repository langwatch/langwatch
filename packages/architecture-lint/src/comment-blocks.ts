import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { ArchitectureViolation } from "./types";
import { walkFiles } from "./files";

const REVIEW_LINE_COUNT = 4;
const MAX_COMMENT_BLOCK_LINES = 5;
const SOURCE_WHITESPACE = new Set([" ", "\t", "\r", "\n"]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".next-saas",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

export type CommentBlockReview = {
  category: "comment-blocks";
  file: string;
  line: number;
  lines: number;
  message: string;
};

export type CommentBlockLintResult = {
  reviews: CommentBlockReview[];
  violations: ArchitectureViolation[];
};

export type CommentBlockLintOptions = {
  files?: readonly string[];
  /**
   * When set (and `files` is not), every tracked source file is scanned:
   * a changed file gets the full check (review at 4-5, error at 6+); every
   * other file is checked only at 6+, and only when `allowedRoots` does not
   * cover it (R1, architecture-lint-burn-down-plan.md §2).
   */
  changedFiles?: readonly string[];
  allowedRoots?: readonly CommentBlockRootEntry[];
  now?: Date;
};

export type CommentBlockRootEntry = {
  root: string;
  blocks: number;
  expires: string;
};

const ROOTS_FILE_NAME = "comment-block-roots.json";
const commentBlockRootEntrySchema = z
  .object({
    root: z.string().min(1),
    blocks: z.number().int().nonnegative(),
    expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const commentBlockRootsFileSchema = z
  .object({ version: z.literal(0), roots: z.array(commentBlockRootEntrySchema) })
  .strict();

export type CommentBlockRootsBaselineCheck = {
  violations: ArchitectureViolation[];
  entries: CommentBlockRootEntry[];
  bootstrapped: boolean;
};

function commentBlockRootsFile(root: string): string {
  return join(root, "packages/architecture-lint/src", ROOTS_FILE_NAME);
}

function readCommentBlockRootsFile(file: string): {
  exists: boolean;
  entries: CommentBlockRootEntry[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) return { exists: false, entries: [], violations: [] };

  let rawValue: unknown;
  try {
    rawValue = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      entries: [],
      violations: [
        {
          policy: "comment-block-root-baseline",
          file,
          message: `Comment block root allowlist must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = commentBlockRootsFileSchema.safeParse(rawValue);
  if (!result.success) {
    return {
      exists: true,
      entries: [],
      violations: [
        {
          policy: "comment-block-root-baseline",
          file,
          message:
            "Comment block root allowlist must contain version 0 and a roots array of { root, blocks, expires }.",
        },
      ],
    };
  }

  const seenRoots = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  const entries: CommentBlockRootEntry[] = [];
  for (const entry of result.data.roots) {
    if (seenRoots.has(entry.root)) {
      violations.push({
        policy: "comment-block-root-baseline",
        file,
        message: `Comment block root allowlist lists ${entry.root} more than once.`,
      });
      continue;
    }
    seenRoots.add(entry.root);
    entries.push(entry);
  }
  return { exists: true, entries, violations };
}

/**
 * Whether a listed root still covers `relativePath` for the whole-repo scan:
 * the entry names the file's root and has not expired as of `today`. An
 * expired entry stops covering its files (they start failing at 6+) and is
 * separately reported by `lintCommentBlockRoots`.
 */
function rootCovers(entry: CommentBlockRootEntry, relativePath: string, today: string): boolean {
  if (entry.expires < today) return false;
  return relativePath === entry.root || relativePath.startsWith(`${entry.root}/`);
}

export function compareCommentBlockRoots(
  reference: readonly CommentBlockRootEntry[],
  proposed: readonly CommentBlockRootEntry[],
  file: string,
): ArchitectureViolation[] {
  const referenceByRoot = new Map(reference.map((entry) => [entry.root, entry]));
  const violations: ArchitectureViolation[] = [];
  for (const entry of proposed) {
    const previous = referenceByRoot.get(entry.root);
    if (!previous) {
      violations.push({
        policy: "comment-block-root-baseline-growth",
        file,
        message: `Comment block root allowlist cannot add ${entry.root}.`,
        allowed: "Burn the root's blocks down instead of adding it to the allowlist.",
      });
      continue;
    }
    if (entry.blocks > previous.blocks) {
      violations.push({
        policy: "comment-block-root-baseline-growth",
        file,
        message: `Comment block root allowlist cannot increase ${entry.root}'s block count.`,
        allowed: "Keep the prior count, or lower it with the burn-down.",
      });
    }
    if (entry.expires > previous.expires) {
      violations.push({
        policy: "comment-block-root-baseline-growth",
        file,
        message: `Comment block root allowlist cannot move ${entry.root}'s expiry later.`,
        allowed: "Keep the prior expiry, or bring it earlier.",
      });
    }
  }
  return violations;
}

/**
 * Reads and validates `comment-block-roots.json`, and reports every entry
 * that has expired as of `now` — an expired entry stops exempting its root
 * from the whole-repo scan (`lintCommentBlocks`) and fails the run in its
 * own right, which is what turns the burn-down schedule into a promise.
 * With a `baselineReference` (the merge-base copy), the file may only shrink:
 * an entry may be removed, its `blocks` lowered, or its `expires` brought
 * earlier, never the reverse (mirrors `lintServiceQualityBaseline`).
 */
export function lintCommentBlockRoots(
  root: string,
  baselineReference?: string,
  now: Date = new Date(),
): CommentBlockRootsBaselineCheck {
  const file = commentBlockRootsFile(root);
  const current = readCommentBlockRootsFile(file);
  const violations = [...current.violations];
  const today = now.toISOString().slice(0, 10);

  for (const entry of current.entries) {
    if (entry.expires < today) {
      violations.push({
        policy: "comment-block-root-expired",
        file,
        message: `Comment block root allowlist entry for ${entry.root} expired ${entry.expires}.`,
        allowed:
          "Burn the root's over-limit blocks down and delete the entry, or bring its own review forward with a new date.",
      });
    }
  }

  if (baselineReference && !current.exists) {
    violations.push({
      policy: "comment-block-root-baseline",
      file,
      message: "Comment block root allowlist must be checked in before it can be compared.",
      allowed: "Commit the reviewed allowlist once; future merge-base checks may only shrink it.",
    });
  }
  if (!baselineReference) {
    return { violations, entries: current.entries, bootstrapped: false };
  }

  const reference = readCommentBlockRootsFile(resolve(root, baselineReference));
  violations.push(...reference.violations);
  if (!reference.exists) {
    return { violations, entries: current.entries, bootstrapped: current.exists };
  }
  violations.push(...compareCommentBlockRoots(reference.entries, current.entries, file));
  return { violations, entries: current.entries, bootstrapped: false };
}

type SourceLine = {
  hasCode: boolean;
  hasComment: boolean;
};

function isSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false;
  const segments = path.split(sep);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(path);
}

function marksGeneratedHeader(source: string): boolean {
  const header = source.split("\n", 40).join("\n").toLowerCase();
  return /(?:@generated|code generated|generated (?:file|by)|auto-generated|autogenerated|automatically generated)/.test(
    header,
  );
}

function marksLicenseHeader(source: string): boolean {
  const header = source.split("\n", 80).join("\n").toLowerCase();
  if (header.includes("spdx-license-identifier")) return true;
  return header.includes("copyright") && /\blicen[cs](?:e|ed)\b/.test(header);
}

const DIRECTIVE_LINE = /^(?:\/\/|\/\*\*?|\*\/?|\*)?\s*(?:eslint-|oxlint-|@ts-)/;

/**
 * A block is exempt when it is only lint/type-checker directives, or when it
 * carries a `@scenario` annotation binding a spec scenario to its test.
 */
function isExemptBlock(text: string): boolean {
  if (/@scenario\b/.test(text)) return true;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "/*" && line !== "*/" && line !== "/**");
  return lines.length > 0 && lines.every((line) => DIRECTIVE_LINE.test(line));
}

function mayContainReviewBlock(source: string): boolean {
  let contiguousLines = 0;
  let insideBlockComment = false;

  for (const line of source.split(/\r?\n/)) {
    const lineComment = line.trimStart().startsWith("//");
    const blockStart = line.indexOf("/*");
    const blockEnd = line.indexOf("*/", insideBlockComment ? 0 : blockStart + 2);
    const commentLike =
      lineComment || insideBlockComment || line.trimStart().startsWith("/*");

    if (commentLike) {
      contiguousLines += 1;
      if (contiguousLines >= REVIEW_LINE_COUNT) return true;
    } else {
      contiguousLines = 0;
    }

    if (insideBlockComment && blockEnd !== -1) insideBlockComment = false;
    if (!insideBlockComment && blockStart !== -1 && blockEnd === -1) {
      insideBlockComment = true;
    }
  }
  return false;
}

function trackedSourceFiles(root: string): string[] | undefined {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
  } catch {
    return void 0;
  }

  const paths = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  });
  return paths
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => resolve(root, path))
    .filter(isSourceFile)
    .sort();
}

function allSourceFiles(root: string): string[] {
  return (
    trackedSourceFiles(root) ??
    walkFiles(root, isSourceFile, { ignoredDirectories: EXCLUDED_DIRECTORIES })
  );
}

function gitOutput(root: string, arguments_: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return void 0;
  }
}

function gitPaths(root: string, arguments_: string[]): string[] {
  return (gitOutput(root, arguments_) ?? "")
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => resolve(root, path))
    .filter(isSourceFile);
}

function mergeBase(root: string): string | undefined {
  for (const reference of ["@{upstream}", "origin/main", "main"]) {
    const base = gitOutput(root, ["merge-base", "HEAD", reference])?.trim();
    if (base) return base;
  }
  return gitOutput(root, ["rev-parse", "HEAD^"])?.trim();
}

/**
 * Finds source files introduced since the branch base, modified locally, or
 * untracked. This lets the hard rule apply to new code without a baseline.
 */
export function changedSourceFiles(root: string): string[] {
  const resolvedRoot = resolve(root);
  if (!gitOutput(resolvedRoot, ["rev-parse", "--is-inside-work-tree"])) {
    return allSourceFiles(resolvedRoot);
  }

  const paths = new Set([
    ...gitPaths(resolvedRoot, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMR",
      "HEAD",
    ]),
    ...gitPaths(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const base = mergeBase(resolvedRoot);
  if (base) {
    for (const path of gitPaths(resolvedRoot, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMR",
      `${base}...HEAD`,
    ])) {
      paths.add(path);
    }
  }
  return [...paths].sort();
}

function sourceFiles(root: string, files: readonly string[] | undefined): string[] {
  if (!files) return allSourceFiles(root);
  return [...new Set(files.map((file) => resolve(root, file)))]
    .filter(isSourceFile)
    .sort();
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\r" && source[index + 1] !== "\n") starts.push(index + 1);
    if (character === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: number[], position: number): number {
  let lower = 0;
  let upper = starts.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const start = starts[middle];
    if (start === undefined || start > position) {
      upper = middle - 1;
    } else {
      lower = middle + 1;
    }
  }
  return upper;
}

function commentRanges(
  source: string,
  file: ts.SourceFile,
): Array<{ pos: number; end: number }> {
  const ranges = new Map<string, { pos: number; end: number }>();
  const add = (comments: ts.CommentRange[] | undefined): void => {
    for (const comment of comments ?? []) {
      ranges.set(`${comment.pos}:${comment.end}`, {
        pos: comment.pos,
        end: comment.end,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    add(ts.getLeadingCommentRanges(source, node.pos));
    add(ts.getTrailingCommentRanges(source, node.end));
    ts.forEachChild(node, visit);
  };

  add(ts.getLeadingCommentRanges(source, 0));
  add(ts.getTrailingCommentRanges(source, source.length));
  visit(file);
  return [...ranges.values()].sort(
    (left, right) => left.pos - right.pos || left.end - right.end,
  );
}

function commentLines(path: string, source: string): SourceLine[] {
  const starts = lineStarts(source);
  const lines = Array.from({ length: starts.length }, () => ({
    hasCode: false,
    hasComment: false,
  }));
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const comments = commentRanges(source, file);

  for (const comment of comments) {
    const start = lineAt(starts, comment.pos);
    const end = lineAt(starts, Math.max(comment.pos, comment.end - 1));
    for (let line = start; line <= end; line += 1) {
      const current = lines[line];
      if (current) current.hasComment = true;
    }
  }

  let commentIndex = 0;
  let line = 0;
  for (let index = 0; index < source.length; index += 1) {
    let completedComment = comments[commentIndex];
    while (completedComment !== undefined && completedComment.end <= index) {
      commentIndex += 1;
      completedComment = comments[commentIndex];
    }
    const comment = comments[commentIndex];
    const inComment =
      comment !== undefined && comment.pos <= index && index < comment.end;
    const character = source[index];
    const code = !inComment && !SOURCE_WHITESPACE.has(character ?? "");
    if (code) {
      const current = lines[line];
      if (current) current.hasCode = true;
    }
    if (character === "\r" && source[index + 1] !== "\n") line += 1;
    if (character === "\n") line += 1;
  }
  return lines;
}

function collectBlocks(
  path: string,
  source: string,
): Array<{ line: number; lines: number }> {
  const blocks: Array<{ line: number; lines: number }> = [];
  const lines = commentLines(path, source);
  let start: number | undefined;

  const finish = (end: number): void => {
    if (start === undefined) return;
    blocks.push({ line: start + 1, lines: end - start });
    start = void 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const commentOnly = line?.hasComment && !line.hasCode;
    if (commentOnly) {
      start ??= index;
      continue;
    }
    finish(index);
  }
  finish(lines.length);
  return blocks;
}

/**
 * Finds unusually long source commentary without conflating it with licence
 * or generated output. The review queue is deliberately separate from normal
 * lint output; only blocks above the hard ceiling fail a lint run.
 */
export function lintCommentBlocks(
  root: string,
  options: CommentBlockLintOptions = {},
): CommentBlockLintResult {
  const resolvedRoot = resolve(root);
  const reviews: CommentBlockReview[] = [];
  const violations: ArchitectureViolation[] = [];
  const budgeted = !options.files && options.changedFiles !== void 0;
  const changedSet = budgeted
    ? new Set(options.changedFiles!.map((file) => resolve(resolvedRoot, file)))
    : void 0;
  const allowedRoots = options.allowedRoots ?? [];
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  // `allSourceFiles` prefers `git ls-files`, which omits untracked files —
  // exactly the ones `changedFiles` exists to catch. Union them in so a new,
  // not-yet-added file is still scanned (and still fails at 6+ unbudgeted).
  const scanFiles = budgeted
    ? [...new Set([...allSourceFiles(resolvedRoot), ...(changedSet ?? [])])].sort()
    : sourceFiles(resolvedRoot, options.files);

  for (const file of scanFiles) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    if (marksGeneratedHeader(source) || marksLicenseHeader(source)) continue;
    if (!mayContainReviewBlock(source)) continue;
    const relativePath = relative(resolvedRoot, file) || file;
    const isChanged = !budgeted || changedSet!.has(file);
    const rawLines = source.split(/\r?\n/);
    for (const block of collectBlocks(file, source)) {
      const blockText = rawLines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");
      if (isExemptBlock(blockText)) continue;
      if (block.lines > MAX_COMMENT_BLOCK_LINES) {
        // Changed files always fail at 6+; every other tracked file fails
        // too unless its root is on the allowlist and has not expired (R1).
        const exempt =
          !isChanged && allowedRoots.some((entry) => rootCovers(entry, relativePath, today));
        if (exempt) continue;
        violations.push({
          policy: "comment-block-size",
          file,
          line: block.line,
          message: `Comment block has ${block.lines} lines; the maximum is ${MAX_COMMENT_BLOCK_LINES}.`,
          allowed:
            "Split the explanation near the code it describes, or move durable narrative to an ADR or developer document.",
        });
      } else if (block.lines >= REVIEW_LINE_COUNT && isChanged) {
        // The 4-5 line warn tier is a changed-file review item; an
        // unbudgeted (whole-repo) file at this size is not scanned.
        reviews.push({
          category: "comment-blocks",
          file: relativePath,
          line: block.line,
          lines: block.lines,
          message: `Comment block has ${block.lines} lines and should receive review attention.`,
        });
      }
    }
  }

  return { reviews, violations };
}
