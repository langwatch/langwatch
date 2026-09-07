import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { ArchitectureViolation } from "./types.ts";
import { walkFiles } from "./files.ts";
import {
  MAX_COMMENT_BLOCK_LINES,
  REVIEW_LINE_COUNT,
  collectCommentBlocks,
  isExemptBlock,
  marksGeneratedHeader,
  marksLicenseHeader,
  mayContainReviewBlock,
} from "@langwatch/lint-core/grammar/comment-block-policy.mjs";
import { type Instant, nowInstant } from "@langwatch/time";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

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

export type CommentBlockLintOptions = {
  files?: readonly string[];
  /** When set (and `files` is not), only these files enter the review queue. */
  changedFiles?: readonly string[];
};

export type CommentBlockLintResult = {
  reviews: CommentBlockReview[];
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
 * earlier, never the reverse (mirrors `lintServiceCeilingsBaseline`).
 */
export function lintCommentBlockRoots(
  root: string,
  baselineReference?: string,
  now: Instant = nowInstant(),
): CommentBlockRootsBaselineCheck {
  const file = commentBlockRootsFile(root);
  const current = readCommentBlockRootsFile(file);
  const violations = [...current.violations];
  const today = now.toString({ fractionalSecondDigits: 3 }).slice(0, 10);

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

function isSourceFile(path: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(path))) return false;

  const segments = path.split(sep);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;

  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(path);
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
    ...gitPaths(resolvedRoot, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]),
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

  return [...new Set(files.map((file) => resolve(root, file)))].filter(isSourceFile).sort();
}

function commentRanges(source: string, file: ts.SourceFile): Array<{ pos: number; end: number }> {
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

  return [...ranges.values()].sort((left, right) => left.pos - right.pos || left.end - right.end);
}

/**
 * The 4-5 line review queue. Anything longer is the oxlint rule
 * `langwatch/comment-block-size`'s business, which reports it in the editor
 * as the code is typed; both read the same block grammar.
 */
export function lintCommentBlocks(
  root: string,
  options: CommentBlockLintOptions = {},
): CommentBlockLintResult {
  const resolvedRoot = resolve(root);
  const reviews: CommentBlockReview[] = [];
  const scanFiles = sourceFiles(resolvedRoot, options.files ?? options.changedFiles);

  for (const file of scanFiles) {
    if (!existsSync(file)) continue;

    const source = readFileSync(file, "utf8");
    if (marksGeneratedHeader(source) || marksLicenseHeader(source)) continue;

    if (!mayContainReviewBlock(source)) continue;

    const relativePath = relative(resolvedRoot, file) || file;
    const rawLines = source.split(/\r?\n/);
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const ranges = commentRanges(source, parsed);
    for (const block of collectCommentBlocks({ source, ranges })) {
      const blockText = rawLines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");
      if (isExemptBlock(blockText)) continue;

      // 4-5 lines only: 6 and above is `langwatch/comment-block-size`.
      if (block.lines < REVIEW_LINE_COUNT || block.lines > MAX_COMMENT_BLOCK_LINES) continue;

      reviews.push({
        category: "comment-blocks",
        file: relativePath,
        line: block.line,
        lines: block.lines,
        message: `Comment block has ${block.lines} lines and should receive review attention.`,
      });
    }
  }

  return { reviews };
}
