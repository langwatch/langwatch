import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_COMMENT_BLOCK_LINES,
  collectCommentBlocks,
  commentBlockSizeMessage,
  isExemptBlock,
  lineAtOffset,
  lineIndex,
  marksGeneratedHeader,
  marksLicenseHeader,
  mayContainReviewBlock,
  rootCovers,
} from "../../grammar/comment-block-policy.mjs";
import { defineRule } from "../define-rule.mjs";

// A block of 6 to 8 lines warns (`comment-block-size-warning.rule.mjs`), 9 or
// more errors, and a comment line wider than 100 columns errors. Both rules
// share the one analysis below: it walks the file's comments exactly once per
// file, memoised so the second rule's visitor is a cache hit, and finds a
// line's number with the shared binary-search index instead of re-slicing
// and re-splitting the source per comment range.

export const COMMENT_BLOCK_WARN_LINES = 6;
export const COMMENT_BLOCK_ERROR_LINES = 9;
export const MAX_COMMENT_COLUMNS = 100;

const COMMENT_EXCLUDED_DIRECTORIES = new Set([
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

const changedFilesCache = new Map();
const commentBlockRootsCache = new Map();
const analysisCache = new Map();

function gitOutput(cwd, arguments_) {
  try {
    return execFileSync("git", ["-C", cwd, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function gitPaths(cwd, arguments_) {
  return (gitOutput(cwd, arguments_) ?? "").split("\0").filter((path) => path.length > 0);
}

function mergeBase(cwd) {
  for (const reference of ["@{upstream}", "origin/main", "main"]) {
    const base = gitOutput(cwd, ["merge-base", "HEAD", reference])?.trim();
    if (base) return base;
  }
  return gitOutput(cwd, ["rev-parse", "HEAD^"])?.trim();
}

/**
 * Files introduced since the branch base, modified locally, or untracked, as
 * workspace-relative paths. `undefined` outside a git checkout, where every
 * file counts as changed — the same fallback the CLI takes.
 */
function changedFiles(cwd) {
  if (changedFilesCache.has(cwd)) return changedFilesCache.get(cwd);
  let changed;
  if (gitOutput(cwd, ["rev-parse", "--is-inside-work-tree"])) {
    changed = new Set([
      ...gitPaths(cwd, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]),
      ...gitPaths(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const base = mergeBase(cwd);
    if (base) {
      for (const path of gitPaths(cwd, [
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        `${base}...HEAD`,
      ])) {
        changed.add(path);
      }
    }
  }
  changedFilesCache.set(cwd, changed);
  return changed;
}

function commentBlockRoots(cwd) {
  if (commentBlockRootsCache.has(cwd)) return commentBlockRootsCache.get(cwd);
  const file = join(cwd, "packages", "architecture-enforcer", "src", "comment-block-roots.json");
  let entries = [];
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version === 0 && Array.isArray(value.roots)) entries = value.roots;
    } catch {
      entries = [];
    }
  }
  commentBlockRootsCache.set(cwd, entries);
  return entries;
}

export function isCommentScannedPath(workspacePath) {
  if (workspacePath.startsWith("../")) return false;
  if (workspacePath.split("/").some((segment) => COMMENT_EXCLUDED_DIRECTORIES.has(segment))) {
    return false;
  }
  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(workspacePath);
}

/**
 * Whether the burn-down allowlist still covers this file. A changed file is
 * never covered: new commentary is held to the limit wherever it lands. Only
 * called once a candidate finding exists — the git-backed lookup and the date
 * computation are wasted on the common case of a file with nothing to report.
 */
export function isCoveredByAllowedRoot(cwd, workspacePath) {
  const changed = changedFiles(cwd);
  if (!changed || changed.has(workspacePath)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return commentBlockRoots(cwd).some((entry) => rootCovers(entry, workspacePath, today));
}

function commentRangesOf(program) {
  return (program.comments ?? [])
    .filter((comment) => comment.type !== "Shebang")
    .map((comment) => ({ pos: comment.start, end: comment.end }))
    .sort((left, right) => left.pos - right.pos || left.end - right.end);
}

/**
 * The one pass over a file's comments: oversized blocks and overlong comment
 * lines, computed together and memoised per file so the size and warning
 * rules — which both need it — pay for it once between them.
 */
export function commentBlockAnalysis(context, file, program) {
  const source = context.sourceCode.text;
  const key = `${context.cwd}|${file.workspacePath}|${source.length}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;

  const result = { blocks: [], columnOverflows: [] };
  const hasHeader = marksGeneratedHeader(source) || marksLicenseHeader(source);
  if (!hasHeader) {
    const lines = source.split(/\r?\n/);
    const ranges = commentRangesOf(program);
    if (mayContainReviewBlock(source)) {
      result.blocks = collectCommentBlocks({ source, ranges }).filter((block) => {
        const text = lines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");
        return !isExemptBlock(text);
      });
    }
    const starts = lineIndex(source);
    const reported = new Set();
    for (const range of ranges) {
      const startLine = lineAtOffset(starts, range.pos);
      const endLine = lineAtOffset(starts, Math.max(range.pos, range.end - 1));
      for (let line = startLine; line <= endLine; line += 1) {
        if (reported.has(line)) continue;
        const width = lines[line - 1]?.length ?? 0;
        if (width <= MAX_COMMENT_COLUMNS) continue;
        reported.add(line);
        result.columnOverflows.push({ line, width });
      }
    }
  }

  analysisCache.set(key, result);
  return result;
}

export const commentBlockSizeRule = defineRule({
  name: "comment-block-size",
  kind: "problem",
  messages: {
    commentColumns: {
      what: "Comment line is {{width}} columns; wrap at {{max}}.",
      fix: "Wrap the line.",
    },
  },
  create(context, file) {
    if (!isCommentScannedPath(file.workspacePath)) return {};

    return {
      Program(program) {
        const analysis = commentBlockAnalysis(context, file, program);
        const oversized = analysis.blocks.filter(
          (block) => block.lines >= COMMENT_BLOCK_ERROR_LINES,
        );
        if (oversized.length === 0 && analysis.columnOverflows.length === 0) return;
        if (isCoveredByAllowedRoot(context.cwd, file.workspacePath)) return;

        for (const block of oversized) {
          context.report({
            loc: { line: block.line, column: 0 },
            message: commentBlockSizeMessage(block.lines),
          });
        }
        for (const overflow of analysis.columnOverflows) {
          context.report({
            loc: { line: overflow.line, column: 0 },
            messageId: "commentColumns",
            data: { max: MAX_COMMENT_COLUMNS, width: overflow.width },
          });
        }
      },
    };
  },
});
