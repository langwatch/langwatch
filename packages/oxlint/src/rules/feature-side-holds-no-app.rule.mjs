import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// The process side installs, mounts and composes modules; it never grows its
// own app. A class here that implements a contract `*Api`, or that is named
// like one of the module shapes (`*Api`, `*App`, `*Delegate`, `Extended*`),
// is the module's app hiding in the wrong package.

const GOVERNED_SOURCE =
  /^apps\/api\/src\/features\/|^apps\/worker\/src\/app\/|^apps\/tasks\/src\//;
const EXCLUDED = /(?:^|\/)__tests__(?:\/|$)/;
const RESERVED_NAME = /Api$|App$|Delegate$|^Extended/;

function isGoverned(workspacePath) {
  return GOVERNED_SOURCE.test(workspacePath) && !EXCLUDED.test(workspacePath);
}

function heritageTypeName(entry) {
  const node = entry?.expression ?? entry;
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return node.property.name;
  }
  return undefined;
}

export const featureSideHoldsNoAppRule = defineRule({
  name: "feature-side-holds-no-app",
  kind: "problem",
  messages: {
    implementsApi: {
      what: "Class `{{name}}` implements the contract type `{{contract}}`.",
      fix: "Move this class into the owning module's server package as its `<Name>App`; the process side keeps an installer, a mount and a composition.",
    },
    reservedName: {
      what: "Class `{{name}}` is named like a module app (`*Api`, `*App`, `*Delegate`, `Extended*`).",
      fix: "Move this class into the owning module and let its installer boot it; the process side holds installers, mounts and compositions only.",
    },
  },
  create(context, file) {
    if (!isGoverned(file.workspacePath)) return {};
    if (
      isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "feature-side-holds-no-app" })
    ) {
      return {};
    }

    const check = (node) => {
      const name = node.id?.name;
      const heritage = [node.superClass, ...(node.implements ?? [])]
        .map(heritageTypeName)
        .filter((candidate) => candidate !== undefined);
      const contract = heritage.find((candidate) => candidate.endsWith("Api"));
      if (contract) {
        context.report({
          node,
          messageId: "implementsApi",
          data: { contract, name: name ?? "(anonymous)" },
        });
        return;
      }
      if (name && RESERVED_NAME.test(name)) {
        context.report({ node, messageId: "reservedName", data: { name } });
      }
    };

    return {
      ClassDeclaration: check,
      ClassExpression: check,
    };
  },
});
