import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// Swallowing a failure is a decision, and a decision that is not written down
// cannot be reviewed. An empty `catch` reads the same whether the author knew
// the call was best-effort or never thought about it, and the difference is
// the whole of the incident. Rethrow, log, or return the value the caller
// gets when the thing did not happen.

export const emptyCatchRule = defineRule({
  name: "empty-catch",
  kind: "problem",
  messages: {
    emptyCatch: {
      what: "`{{form}}` swallows the failure without saying so.",
      fix: "Rethrow it, log it with the trace id, or return the value the caller gets when this fails.",
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "empty-catch" })) {
      return {};
    }

    return {
      CatchClause(node) {
        // A comment is not a statement, so a block holding only one is empty
        // here, which is the point: a note is not a decision the code makes.
        const statements = node.body.body;
        if (statements.length > 0) return;

        const form =
          node.param?.type === "Identifier" ? `catch (${node.param.name}) {}` : "catch {}";

        context.report({ node, messageId: "emptyCatch", data: { form } });
      },
    };
  },
});
