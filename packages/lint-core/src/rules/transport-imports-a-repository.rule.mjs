import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A route holds a request, not a table. Everything a transport declaration
// needs it asks the module's app for, and the app is where the guards, the
// tenancy filter and the authz decision live. A route that reaches a
// repository has walked round all three, and no reviewer reading the route
// can see that it did.

const GOVERNED = /^(?:enterprise\/)?modules\/[^/]+\/server\/src\/transport\//;
const REPOSITORY_FOLDER = /(?:^|\/)repositories\//;
const REPOSITORY_MODULE = /\.repository(?:\.[cm]?[jt]sx?)?$/;
const REPOSITORY_NAME = /Repository$/;

// A transport test builds its own memory repository to stand the route up;
// the ruling is about what a running route holds, not how it is tested.
function isTransportDeclaration(file) {
  return file.isProduction && GOVERNED.test(file.workspacePath);
}

function importedNameOf(specifier) {
  if (specifier.type === "ImportSpecifier") {
    return specifier.imported.type === "Identifier" ? specifier.imported.name : undefined;
  }

  return specifier.local?.name;
}

function specifierOf(node) {
  const source = node.source;
  const isStringLiteral = source?.type === "Literal";
  if (!isStringLiteral) return undefined;

  return typeof source.value === "string" ? source.value : undefined;
}

/** Which path offence a specifier is, if any. */
function pathOffenceOf(specifier) {
  if (REPOSITORY_FOLDER.test(specifier)) return "repositoryFolder";

  return REPOSITORY_MODULE.test(specifier) ? "repositoryModule" : undefined;
}

/**
 * The value-imported names that are repositories. A type-only name is erased,
 * so it cannot be the thing the route calls.
 */
function repositoryNamesOf(node) {
  if (node.importKind === "type") return [];

  const found = [];
  for (const imported of node.specifiers ?? []) {
    if (imported.importKind === "type") continue;
    const name = importedNameOf(imported);
    const isRepository = typeof name === "string" && REPOSITORY_NAME.test(name);
    if (isRepository) found.push({ name, node: imported });
  }

  return found;
}

export const transportImportsARepositoryRule = defineRule({
  name: "transport-imports-a-repository",
  kind: "problem",
  applies: isTransportDeclaration,
  messages: {
    repositoryFolder: {
      what: "`{{specifier}}` reaches the module's `repositories/` folder from a transport file.",
      fix: "Call the module's app instead; the app owns the guards, the tenancy filter and the authz decision.",
    },
    repositoryModule: {
      what: "`{{specifier}}` is a repository module imported from a transport file.",
      fix: "Call the module's app instead; the app owns the guards, the tenancy filter and the authz decision.",
    },
    repositoryName: {
      what: "`{{name}}` is a repository held as a value in a transport file.",
      fix: "Take the module's app as the dependency and call a service method on it.",
    },
  },
  create(context, file) {
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "transport-imports-a-repository",
      })
    ) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const specifier = specifierOf(node);
        if (!specifier) return;

        const pathOffence = pathOffenceOf(specifier);
        if (pathOffence) {
          context.report({ node, messageId: pathOffence, data: { specifier } });

          return;
        }

        for (const { name, node: held } of repositoryNamesOf(node)) {
          context.report({ node: held, messageId: "repositoryName", data: { name } });
        }
      },
    };
  },
});
