import { defineRule } from "../define-rule.mjs";

// Only `repositories/<store>/**` names a store client, and a registry hands the
// clients in (ARCHITECTURE.md §3.2, §7). One row per store; Prisma alone is
// refused even as a type, and a Redis channel speaks to its own client.

const STORES = [
  {
    folder: "prisma",
    packages: /^(?:@langwatch\/prisma-client|@prisma\/client)(?:\/|$)/,
    registryValues: new Set(["PrismaRepository", "prismaRepositories", "prismaTables"]),
    store: "Prisma",
    typesTravel: false,
  },
  {
    folder: "clickhouse",
    packages: /^(?:@langwatch\/clickhouse-client|@clickhouse\/client)(?:\/|$)/,
    registryValues: new Set(),
    store: "ClickHouse",
    typesTravel: true,
  },
  {
    channelTier: "redis",
    folder: "redis",
    packages: /^(?:@langwatch\/redis-client|ioredis)(?:\/|$)/,
    registryValues: new Set(),
    store: "Redis",
    typesTravel: true,
  },
];

const MODULE_ROLES = new Set(["contract", "process", "browser", "browser-kit"]);
const REPOSITORY_REGISTRY = /^repositories\/[^/]+\.registry\.ts$/;

function isGoverned(file) {
  if (file.isTest) return false;

  return MODULE_ROLES.has(file.role) || file.kind === "application";
}

function sourceOf(node) {
  const value = node.source?.value;

  return typeof value === "string" ? value : undefined;
}

function bindingsOf(node) {
  return node.specifiers ?? [];
}

function isTypeBinding(node, binding) {
  if (node.importKind === "type" || node.exportKind === "type") return true;

  return binding.importKind === "type" || binding.exportKind === "type";
}

/** The names a node brings in as values; a side-effect or dynamic import is one unnamed value. */
function valueNamesOf(node) {
  if (node.importKind === "type" || node.exportKind === "type") return [];
  if (node.type === "ImportExpression" || node.type === "ExportAllDeclaration") return ["*"];
  const bindings = bindingsOf(node);
  if (bindings.length === 0) return ["*"];

  return bindings
    .filter((binding) => !isTypeBinding(node, binding))
    .map((binding) => binding.imported?.name ?? binding.local?.name ?? "*");
}

function isSeam({ row, sourcePath }) {
  if (sourcePath.startsWith(`repositories/${row.folder}/`)) return true;

  return Boolean(row.channelTier) && sourcePath.startsWith(`channels/${row.channelTier}/`);
}

function isProcessSeam({ file, row, values }) {
  if (file.role !== "process" || !file.sourcePath) return false;
  if (isSeam({ row, sourcePath: file.sourcePath })) return true;

  return (
    REPOSITORY_REGISTRY.test(file.sourcePath) &&
    values.every((name) => row.registryValues.has(name))
  );
}

function isAllowed({ file, node, row }) {
  const values = valueNamesOf(node);
  if (isProcessSeam({ file, row, values })) return true;

  return row.typesTravel && values.length === 0;
}

function messageFor({ file, row }) {
  if (file.kind === "application") return "storeInApplication";

  return row.typesTravel ? "storeClientValue" : "storeNamed";
}

export const storeContainmentRule = defineRule({
  name: "store-containment",
  kind: "problem",
  applies: isGoverned,
  messages: {
    storeClientValue: {
      what: "`{{specifier}}` is the {{store}} client, value-imported outside `repositories/{{folder}}/`.",
      why: "A service holding its own client has a second, unswappable path to the module's data.",
      fix: "Move the query into `repositories/{{folder}}/{{folder}}.<subject>.repository.ts` behind the `repositories/<subject>.repository.ts` interface and call that from the service; a file that only needs a type writes `import type`.",
    },
    storeNamed: {
      what: "`{{specifier}}` names {{store}} outside `repositories/{{folder}}/`.",
      fix: "Move the query into `repositories/{{folder}}/{{folder}}.<subject>.repository.ts` behind the `repositories/<subject>.repository.ts` interface and call that from the service; only that folder names {{store}}, even as a type.",
    },
    storeInApplication: {
      what: "`{{specifier}}` is a {{store}} client named in an application.",
      fix: "Delete the import: the `Server` chain opens every store, and only a module's repositories and channels hold a client.",
    },
  },
  create(context, file) {
    const check = (node) => {
      const specifier = sourceOf(node);
      if (!specifier) return;
      const row = STORES.find((candidate) => candidate.packages.test(specifier));
      if (!row || isAllowed({ file, node, row })) return;

      context.report({
        node,
        messageId: messageFor({ file, row }),
        data: { folder: row.folder, specifier, store: row.store },
      });
    };

    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
});
