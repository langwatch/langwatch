import {
  COMMENT_BLOCK_ERROR_LINES,
  COMMENT_BLOCK_WARN_LINES,
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
//
// The messages below are written locally rather than shared with the error
// tier's text: a reader who trims a 9-line block to 7 lines is still over the
// real 5-line maximum, only now warned instead of errored, and that has to be
// said explicitly here or the trim reads as "done".

/** Whether a `@lint-keep` earns its silence: a real reason, and the ADR that records it. */
function isJustified(keep) {
  return keep.records && keep.words >= LINT_KEEP_REASON_WORDS;
}

export const commentBlockSizeWarningRule = defineRule({
  name: "comment-block-size-warning",
  kind: "style",
  messages: {
    commentBlockSize: {
      what:
        "Comment block has {{lines}} lines. The real maximum is {{max}}; this is only a warning" +
        " and not an error because it has not reached {{error}} lines yet.",
      fix:
        "Delete it when the code already says it, or move the narrative into an ADR under" +
        " `dev/docs/adr/` and leave one line here linking it. Trimming to under {{error}} lines" +
        " does not clear this warning — only {{max}} lines or fewer does. Keeping it with" +
        " `@lint-keep <reason> dev/docs/adr/<file>.md` inside it is almost never right; see ADR-140.",
    },
    commentKeepReason: {
      what:
        "The `@lint-keep` on this {{lines}}-line block is missing either a reason of {{words}}+" +
        " words or the ADR recording it, so the block still counts as over the {{max}}-line limit.",
      fix:
        "Delete the block and move its narrative into that ADR — that clears this permanently." +
        " Keeping it with `@lint-keep <reason> dev/docs/adr/<file>.md` inside it is almost never" +
        " right, but if you do, that line needs a full clause of {{words}}+ words plus the ADR path.",
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
              error: COMMENT_BLOCK_ERROR_LINES,
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
