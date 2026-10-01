import {
  COMMENT_BLOCK_ERROR_FIX,
  COMMENT_BLOCK_ERROR_WHAT,
  MAX_COMMENT_BLOCK_LINES,
  isExemptBlock,
  marksGeneratedHeader,
  marksScenarioBinding,
  structuralTagLines,
  marksLicenseHeader,
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

const GENERATED_HEADER_LINES = 40;
const LICENSE_HEADER_LINES = 80;

function commentsOf(program) {
  const comments = (program.comments ?? []).filter((comment) => comment.type !== "Shebang");

  return comments.every((comment, index) => index === 0 || comment.start >= comments[index - 1].end)
    ? comments
    : comments.toSorted((left, right) => left.start - right.start || left.end - right.end);
}

/** The comment text within the first `lastLine` lines, cut at the line boundary. */
function headerTextOf({ comments, lastLine, text }) {
  let limit = -1;
  for (let line = 0; line < lastLine && limit !== text.length; line += 1) {
    const newline = text.indexOf("\n", limit + 1);
    limit = newline === -1 ? text.length : newline;
  }

  return comments
    .filter((comment) => comment.start < limit)
    .map((comment) => text.slice(comment.start, Math.min(comment.end, limit)))
    .join("\n");
}

function hasHeader({ comments, text }) {
  const first = comments[0];
  if (first === undefined || first.loc.start.line > LICENSE_HEADER_LINES) return false;

  return (
    marksGeneratedHeader(headerTextOf({ comments, lastLine: GENERATED_HEADER_LINES, text })) ||
    marksLicenseHeader(headerTextOf({ comments, lastLine: LICENSE_HEADER_LINES, text }))
  );
}

/** The lines that carry code beside a comment, found from the text around each comment alone. */
function linesWithCode({ comments, text }) {
  const withCode = new Set();
  comments.forEach((comment, index) => {
    let lineStart = text.lastIndexOf("\n", comment.start - 1) + 1;
    const previous = comments[index - 1];
    if (previous !== undefined && previous.end > lineStart) lineStart = previous.end;
    if (/\S/.test(text.slice(lineStart, comment.start))) withCode.add(comment.loc.start.line);

    let lineEnd = text.indexOf("\n", comment.end);
    if (lineEnd === -1) lineEnd = text.length;
    const next = comments[index + 1];
    if (next !== undefined && next.start < lineEnd) lineEnd = next.start;
    if (/\S/.test(text.slice(comment.end, lineEnd))) withCode.add(comment.loc.end.line);
  });

  return withCode;
}

/** The runs of consecutive comment-only lines, as `{ line, lines }`. */
function commentBlocks({ comments, text }) {
  const withCode = linesWithCode({ comments, text });
  const runs = [];
  for (const comment of comments) {
    let from = comment.loc.start.line;
    let to = comment.loc.end.line;
    if (withCode.has(from)) from += 1;
    if (withCode.has(to)) to -= 1;
    if (from > to) continue;
    const last = runs.at(-1);
    if (last !== undefined && from <= last.to + 1) last.to = Math.max(last.to, to);
    else runs.push({ from, to });
  }

  return runs.map((run) => ({ line: run.from, lines: run.to - run.from + 1 }));
}

/** One block, measured in commentary; structural JSDoc tags come from the signature. */
function describeBlock(block, sourceCode) {
  const text = sourceCode.lines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");

  return { ...block, exempt: isExemptBlock(text), lines: block.lines - structuralTagLines(text) };
}

/** Every comment line past the column limit, each reported once however many comments cover it. */
function overlongCommentLines({ comments, text }) {
  const seen = new Set();
  const overflows = [];

  for (const comment of comments) {
    let lineStart = text.lastIndexOf("\n", comment.start - 1) + 1;
    let line = comment.loc.start.line;
    while (lineStart <= Math.max(comment.start, comment.end - 1)) {
      const newline = text.indexOf("\n", lineStart);
      const lineEnd = newline === -1 ? text.length : newline;
      const width = lineEnd - lineStart - (text[lineEnd - 1] === "\r" ? 1 : 0);
      // A scenario binding quotes its spec title verbatim, so it cannot be
      // rewrapped: reporting it would be an error with no legal fix.
      const isWide = width > MAX_COMMENT_COLUMNS && !seen.has(line);
      if (isWide && !marksScenarioBinding(text.slice(lineStart, lineEnd))) {
        overflows.push({ line, width });
      }
      seen.add(line);
      lineStart = lineEnd + 1;
      line += 1;
    }
  }

  return overflows;
}

/** The one pass over a file's comments: oversized blocks and overlong comment lines. */
export function commentBlockAnalysis(context, program) {
  const comments = commentsOf(program);
  const text = context.sourceCode.text;
  if (comments.length === 0 || hasHeader({ comments, text })) {
    return { blocks: [], columnOverflows: [] };
  }

  const blocks = commentBlocks({ comments, text })
    .filter((block) => block.lines > MAX_COMMENT_BLOCK_LINES)
    .map((block) => describeBlock(block, context.sourceCode))
    .filter((block) => !block.exempt);

  return { blocks, columnOverflows: overlongCommentLines({ comments, text }) };
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
