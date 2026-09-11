import {
  COMMENT_BLOCK_SIZE_MESSAGE,
  MAX_COMMENT_BLOCK_LINES,
} from "../../grammar/comment-block-policy.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  COMMENT_BLOCK_ERROR_LINES,
  COMMENT_BLOCK_WARN_LINES,
  commentBlockAnalysis,
  isCommentScannedPath,
  isCoveredByAllowedRoot,
} from "./comment-block-size.rule.mjs";

// The 6-8 line tier of the same analysis `comment-block-size.rule.mjs`
// computes; sharing that memo is what keeps this from re-walking the file's
// comments a second time.

export const commentBlockSizeWarningRule = defineRule({
  name: "comment-block-size-warning",
  kind: "style",
  messages: {
    commentBlockSize: {
      what: COMMENT_BLOCK_SIZE_MESSAGE,
      fix: "",
    },
  },
  create(context, file) {
    if (!isCommentScannedPath(file.workspacePath)) return {};

    return {
      Program(program) {
        const analysis = commentBlockAnalysis(context, file, program);
        const warned = analysis.blocks.filter(
          (block) =>
            block.lines >= COMMENT_BLOCK_WARN_LINES && block.lines < COMMENT_BLOCK_ERROR_LINES,
        );
        if (warned.length === 0) return;
        if (isCoveredByAllowedRoot(context.cwd, file.workspacePath)) return;

        for (const block of warned) {
          context.report({
            loc: { line: block.line, column: 0 },
            messageId: "commentBlockSize",
            data: { lines: block.lines, max: MAX_COMMENT_BLOCK_LINES },
          });
        }
      },
    };
  },
});
