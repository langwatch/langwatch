import {
  COMMENT_BLOCK_ERROR_LINES,
  COMMENT_BLOCK_SIZE_FIX,
  COMMENT_BLOCK_SIZE_WHAT,
  COMMENT_BLOCK_WARN_LINES,
  COMMENT_KEEP_REASON_FIX,
  COMMENT_KEEP_REASON_WHAT,
  LINT_KEEP_REASON_WORDS,
  MAX_COMMENT_BLOCK_LINES,
} from "../../grammar/comment-block-policy.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  commentBlockAnalysis,
  isCommentScannedPath,
  isCoveredByAllowedRoot,
} from "./comment-block-size.rule.mjs";

// The 6-8 line tier of the same analysis `comment-block-size.rule.mjs`
// computes; sharing that memo is what keeps this from re-walking the file's
// comments a second time. This is the only tier `@lint-keep` can silence, and
// only when it gives a reason AND names the ADR holding the narrative - almost
// every long block should be deleted or moved instead.

/** Whether a `@lint-keep` earns its silence: a real reason, and the ADR that records it. */
function isJustified(keep) {
  return keep.records && keep.words >= LINT_KEEP_REASON_WORDS;
}

export const commentBlockSizeWarningRule = defineRule({
  name: "comment-block-size-warning",
  kind: "style",
  messages: {
    commentBlockSize: {
      what: COMMENT_BLOCK_SIZE_WHAT,
      fix: COMMENT_BLOCK_SIZE_FIX,
    },
    commentKeepReason: {
      what: COMMENT_KEEP_REASON_WHAT,
      fix: COMMENT_KEEP_REASON_FIX,
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
          if (block.keep.present && isJustified(block.keep)) continue;

          context.report({
            loc: { line: block.line, column: 0 },
            messageId: block.keep.present ? "commentKeepReason" : "commentBlockSize",
            data: {
              lines: block.lines,
              max: MAX_COMMENT_BLOCK_LINES,
              words: LINT_KEEP_REASON_WORDS,
            },
          });
        }
      },
    };
  },
});
