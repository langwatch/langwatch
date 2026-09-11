import { crossingFor } from "../../grammar/module-layers.mjs";
import { defineRule } from "../define-rule.mjs";

// A repository owns state and takes the store it reads. Reaching up to a
// service or the app inverts the module: the behaviour that decides is then
// downstream of the rows it decides about, and no test can stand a repository
// in for itself without booting half the module.

function isRepository(file) {
  return (
    file.role === "server" && file.isProduction && Boolean(file.sourcePath?.startsWith("repositories/"))
  );
}

export const repositoryTakesOnlyItsStoreRule = defineRule({
  name: "repository-takes-only-its-store",
  kind: "problem",
  messages: {
    repositoryTakesMoreThanItsStore: {
      what: "A repository names {{crossed}} (`{{specifier}}`).",
      why: "A repository takes the store it reads and nothing else. Behaviour lives in the service and the app above it, and outside its own package a module is its App.",
      fix: "Move the decision into the service that calls this repository, and keep the repository over its store alone.",
    },
  },
  applies: isRepository,
  create(context, file) {
    return {
      ImportDeclaration(node) {
        const specifier = node.source?.value;
        if (typeof specifier !== "string") return;
        if (node.importKind === "type") return;

        const crossed = crossingFor({ layer: "repositories", sourcePath: file.sourcePath, specifier });
        if (crossed) {
          context.report({
            node,
            messageId: "repositoryTakesMoreThanItsStore",
            data: { crossed, specifier },
          });
        }
      },
    };
  },
});
