import { defineRule } from "../define-rule.mjs";
import { isFallibleResultModule, isTryPrefixedName } from "./fallible-result-naming.rule.mjs";

// A `try<Noun>` name describes how it behaves on failure, not what it
// answers, whether or not the body swallows anything (only 3.8% do, see
// fallible-result-naming's `tryPrefix`) — so this message never claims a
// catch. This rule owns that naming defect alone: `nullableWithoutFind`
// exempts a try-prefixed name so a nullable `try*` method reports once.

export const noTryPrefixRule = defineRule({
  name: "no-try-prefix",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    noTryPrefix: {
      what: "`{{name}}` is named for how it behaves on failure, not for what it returns.",
      why: "A caller reading the call site cannot tell a lookup from a hedge, and the two need different handling.",
      fix:
        "If `{{name}}` genuinely answers with absence and its callers branch on that,"
        + " rename it `find<Noun>` for the thing it looks up. Otherwise drop `try` from"
        + " the name and let it answer or throw.",
    },
  },
  create(context) {
    const check = (key, accessibility) => {
      if (!key || key.type !== "Identifier") return;
      if (accessibility === "private") return;
      if (!isTryPrefixedName(key.name)) return;

      context.report({ node: key, messageId: "noTryPrefix", data: { name: key.name } });
    };

    const checkMethod = (node) => {
      if (node.kind !== "method" || node.computed) return;
      check(node.key, node.accessibility);
    };

    return {
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (node.computed) return;
        check(node.key, undefined);
      },
      FunctionDeclaration(node) {
        check(node.id, undefined);
      },
    };
  },
});
