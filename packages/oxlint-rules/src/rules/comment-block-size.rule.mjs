import {
  COMMENT_BLOCK_ERROR_FIX,
  COMMENT_BLOCK_ERROR_WHAT,
  MAX_COMMENT_BLOCK_LINES,
  collectCommentBlocks,
  isExemptBlock,
  lineAtOffset,
  lineIndex,
  marksGeneratedHeader,
  marksScenarioBinding,
  structuralTagLines,
  marksLicenseHeader,
  mayContainReviewBlock,
} from "../../grammar/comment-block-policy.mjs";
import { defineRule } from "../define-rule.mjs";

// Two checks, both errors: a block past five lines, and a comment line past
// 100 columns. The narrative is ADR-140.

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

export function isCommentScannedPath(workspacePath) {
  if (workspacePath.startsWith("../")) return false;
  const segments = workspacePath.split("/");
  const excluded = segments.some((segment) => COMMENT_EXCLUDED_DIRECTORIES.has(segment));
  if (excluded) return false;
  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(workspacePath);
}

function commentRangesOf(program) {
  return (program.comments ?? [])
    .filter((comment) => comment.type !== "Shebang")
    .map((comment) => ({ pos: comment.start, end: comment.end }))
    .toSorted((left, right) => left.pos - right.pos || left.end - right.end);
}

/** One block, measured in commentary; structural JSDoc tags come from the signature. */
function describeBlock(block, lines) {
  const text = lines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");

  return { ...block, exempt: isExemptBlock(text), lines: block.lines - structuralTagLines(text) };
}

/** Every comment line past the column limit, each reported once however many ranges cover it. */
function overlongCommentLines({ lines, ranges, source }) {
  const starts = lineIndex(source);
  const seen = new Set();
  const overflows = [];

  for (const range of ranges) {
    const startLine = lineAtOffset(starts, range.pos);
    const endLine = lineAtOffset(starts, Math.max(range.pos, range.end - 1));
    for (let line = startLine; line <= endLine; line += 1) {
      const text = lines[line - 1] ?? "";
      if (seen.has(line) || text.length <= MAX_COMMENT_COLUMNS) continue;
      seen.add(line);
      // A scenario binding quotes its spec title verbatim, so it cannot be
      // rewrapped: reporting it would be an error with no legal fix.
      if (!marksScenarioBinding(text)) overflows.push({ line, width: text.length });
    }
  }

  return overflows;
}

/** The one pass over a file's comments: oversized blocks and overlong comment lines. */
export function commentBlockAnalysis(context, program) {
  const source = context.sourceCode.text;
  const result = { blocks: [], columnOverflows: [] };
  const hasHeader = marksGeneratedHeader(source) || marksLicenseHeader(source);
  if (!hasHeader) {
    const lines = source.split(/\r?\n/);
    const ranges = commentRangesOf(program);
    if (mayContainReviewBlock(source)) {
      result.blocks = collectCommentBlocks({ source, ranges })
        .map((block) => describeBlock(block, lines))
        .filter((block) => !block.exempt);
    }
    result.columnOverflows = overlongCommentLines({ lines, ranges, source });
  }

  return result;
}

export const commentBlockSizeRule = defineRule({
  name: "comment-block-size",
  kind: "problem",
  messages: {
    commentBlockSize: {
      what: COMMENT_BLOCK_ERROR_WHAT,
      why:
        "A comment is for what the code cannot say. The rule makes two checks: a block of" +
        ` more than ${MAX_COMMENT_BLOCK_LINES} lines, and a comment line wider than ${MAX_COMMENT_COLUMNS} columns.`,
      fix: COMMENT_BLOCK_ERROR_FIX,
    },
    commentColumns: {
      what: "Comment line is {{width}} columns; wrap at {{max}}.",
      why: `The rule's second check: a comment line is at most ${MAX_COMMENT_COLUMNS} columns wide.`,
      fix:
        "Wrap it at {{max}} columns, keeping the sentence whole across the break. If it only" +
        " restates the code beside it, delete it instead of wrapping it.",
    },
  },
  create(context, file) {
    if (!isCommentScannedPath(file.workspacePath)) return {};

    return {
      Program(program) {
        const analysis = commentBlockAnalysis(context, program);
        const oversized = analysis.blocks.filter((block) => block.lines > MAX_COMMENT_BLOCK_LINES);
        if (oversized.length === 0 && analysis.columnOverflows.length === 0) return;

        for (const block of oversized) {
          context.report({
            loc: { line: block.line, column: 0 },
            messageId: "commentBlockSize",
            data: { lines: block.lines, max: MAX_COMMENT_BLOCK_LINES },
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
