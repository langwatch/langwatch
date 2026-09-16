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
        "Decide what it answers, then drop `try` either way. If it answers one thing"
        + " that may not exist, name it `get<Noun>` — or `getBy<Key>` when the key is"
        + " what distinguishes it — and throw the domain error instead of null. If it"
        + " answers none or many, return an array and name it `find<Noun>`: the empty"
        + " array is the absence. Renaming it to a `find*` that still answers null is"
        + " the one move to avoid — `find` states cardinality, so that name would"
        + " promise a list and hand back a maybe.",
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
