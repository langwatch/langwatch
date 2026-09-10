import { dirname, relative, resolve, sep } from "node:path";
import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// Ruling (Alex, 2026-09-10): outside its own package a module is its App,
// reached through the contract's Api token, and nothing else. Importing a
// repository or a service straight out of `@langwatch/<m>-server` from
// another package is exactly the shape this rule refuses.

const PACKAGE_SPECIFIER = /^@langwatch\/(enterprise-)?([a-z0-9][a-z0-9-]*)-server$/;
const RELATIVE_TARGET = /^(enterprise\/)?modules\/([^/]+)\/server\//;

function packageNameOf(specifier) {
  return specifier.split("/").slice(0, 2).join("/");
}

function targetOfSpecifier(specifier) {
  const match = packageNameOf(specifier).match(PACKAGE_SPECIFIER);
  if (!match) return undefined;
  return { enterprise: Boolean(match[1]), module: match[2] };
}

function targetOfRelative(filename, specifier, cwd) {
  const targetPath = resolve(dirname(filename), specifier);
  const workspacePath = relative(cwd, targetPath).split(sep).join("/");
  const match = workspacePath.match(RELATIVE_TARGET);
  if (!match) return undefined;
  return { enterprise: Boolean(match[1]), module: match[2] };
}

function targetOf(filename, specifier, cwd) {
  return targetOfSpecifier(specifier) ?? (specifier.startsWith(".") ? targetOfRelative(filename, specifier, cwd) : undefined);
}

/** The installer, transport declarations, the Infrastructure type, and (in a test file) a fixture double. */
function isAllowedName(name, { isTest, isTypeOnly }) {
  if (typeof name !== "string") return false;
  if (isTypeOnly) return name.endsWith("Infrastructure");
  if (name.endsWith("Server")) return true;
  if (name.endsWith("Rest") || name.endsWith("Trpc") || name.endsWith("Transport") || name.endsWith("Sse")) {
    return true;
  }
  return isTest && name.endsWith("Fixture");
}

function importedNameOf(specifierNode) {
  if (specifierNode.type === "ImportSpecifier") {
    return specifierNode.imported.type === "Identifier" ? specifierNode.imported.name : undefined;
  }
  return specifierNode.local?.name;
}

export const moduleAppOnlyAcrossPackagesRule = defineRule({
  name: "module-app-only-across-packages",
  kind: "problem",
  messages: {
    reachThroughApi: {
      what: "`{{name}}` reaches `{{module}}`'s server package directly.",
      fix: "Reach {{module}} through its contract Api token; a module is its App outside its package.",
    },
  },
  create(context, file) {
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "module-app-only-across-packages",
      })
    ) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.source?.type !== "Literal" || typeof node.source.value !== "string") return;
        const specifier = node.source.value;
        const target = targetOf(file.filename, specifier, context.cwd);
        if (!target) return;

        const ownRoot = `${target.enterprise ? "enterprise/" : ""}modules/${target.module}/server/`;
        if (file.workspacePath.startsWith(ownRoot)) return;

        const specifiers = node.specifiers ?? [];
        if (specifiers.length === 0) {
          context.report({ node, messageId: "reachThroughApi", data: { name: specifier, module: target.module } });
          return;
        }

        for (const specifierNode of specifiers) {
          const isTypeOnly = node.importKind === "type" || specifierNode.importKind === "type";
          const name = importedNameOf(specifierNode);
          if (isAllowedName(name, { isTest: file.isTest, isTypeOnly })) continue;

          context.report({
            node: specifierNode,
            messageId: "reachThroughApi",
            data: { name: name ?? specifier, module: target.module },
          });
        }
      },
    };
  },
});
