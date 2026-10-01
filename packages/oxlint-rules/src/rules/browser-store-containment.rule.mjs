import { defineRule } from "../define-rule.mjs";

// One zustand store per feature, under `behavior/`, private to the module
// (ARCHITECTURE.md, browser state tiers). A kit owning its concept's store is
// a different seam and is not governed here.

const ZUSTAND = /^zustand(?:\/vanilla)?$/;
const CREATORS = new Set(["create", "createStore"]);
const DECLARATION = /^[^/]+\.web\.tsx?$/;
const STORE_NAME = /^use[A-Z]\w*Store$/;
const STORE_FILE = /store[^/]*$/i;

function exportedNamesOf(node) {
  const names = (node.specifiers ?? []).map((specifier) => specifier.exported?.name);
  const declared = node.declaration?.declarations ?? [];

  return [...names, ...declared.map((declarator) => declarator.id?.name)];
}

function exportsStore(node) {
  if (node.exportKind === "type") return false;
  const source = node.source?.value;
  if (typeof source === "string" && STORE_FILE.test(source)) return true;

  return exportedNamesOf(node).some((name) => STORE_NAME.test(name ?? ""));
}

export const browserStoreContainmentRule = defineRule({
  name: "browser-store-containment",
  kind: "problem",
  applies: (file) => file.role === "browser" && !file.isTest,
  messages: {
    storeOutsideBehavior: {
      what: "`{{name}}` from zustand creates a store outside `behavior/`.",
      why: "Shared client state has one named home per feature; a store anywhere else is invisible to the reader.",
      fix: "Move the store to `behavior/<feature>.store.ts` and call it from there, with each action a named function.",
    },
    storeExported: {
      what: "The package's declaration file exports a store.",
      why: "A store is module-private; another module reading it couples to its shape and bypasses its contract.",
      fix: "Delete the export; publish the answer or the action the other module needs through the module's contract or a `*HostApi`.",
    },
  },
  create(context, file) {
    const creators = new Set();
    const inBehavior = /(?:^|\/)behavior\//.test(file.sourcePath ?? "");
    const isDeclaration = DECLARATION.test(file.sourcePath ?? "");
    const checkExport = (node) => {
      if (isDeclaration && exportsStore(node)) context.report({ node, messageId: "storeExported" });
    };

    return {
      ExportAllDeclaration: checkExport,
      ExportNamedDeclaration: checkExport,
      ImportDeclaration(node) {
        if (node.importKind === "type" || !ZUSTAND.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const imported = specifier.imported?.name;
          if (CREATORS.has(imported)) creators.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier" || !creators.has(callee.name) || inBehavior) return;
        context.report({ node, messageId: "storeOutsideBehavior", data: { name: callee.name } });
      },
    };
  },
});
