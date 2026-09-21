import { defineRule } from "../define-rule.mjs";

// ClickHouse gets the same containment Prisma and Redis have: only the
// repository that owns a table, the adapter beside it, or the composition root
// that builds the one connection a process holds, may value-import a client.
// Everywhere else asks for the query through a service, the way the rest of
// the codebase already does for Postgres.

const CLICKHOUSE_CLIENT = "@langwatch/clickhouse-client";
const CLICKHOUSE_DRIVER = "@clickhouse/client";
const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);
// The process-boot files that actually construct or shut down the client:
// `<app>-clickhouse.members.ts`, `<app>-clickhouse.infrastructure.ts`,
// `clickhouse-member.ts` and friends. Named by convention, not by folder, so
// the allowance follows the file wherever it is built.
const BOOT_MEMBERS_FILE = /(?:\.members\.ts|-member\.ts|-members\.ts|\.infrastructure\.ts)$/;
// Packages whose whole job is ClickHouse: the client wrapper itself, the
// boot-time member construction every process composes from, and the test
// harness that stands endpoints up. The driver is their domain, not a leak
// out of one.
const CLICKHOUSE_NATIVE_PACKAGE = /^packages\/(?:clickhouse-client|process-stores|test-harness)\//;

/**
 * The package a file belongs to, for the boundary rule that asks what kind of
 * package it is standing in. Mirrors `prisma-containment`'s own
 * `prismaPackageOf`.
 */
function clickhousePackageOf(workspacePath) {
  const feature = workspacePath.match(
    /^(enterprise\/)?modules\/([^/]+)\/(contract|process|browser|browser-kit)\/src\/(.+)$/,
  );
  if (feature) {
    return { kind: feature[3], feature: feature[2], relative: feature[4], workspacePath };
  }
  const application = workspacePath.match(/^apps\/([^/]+)\/src\/(.+)$/);
  if (application && APPLICATION_ROOTS.has(application[1])) {
    return { kind: "application", relative: application[2], workspacePath };
  }
  const composition = workspacePath.match(
    /^enterprise\/packages\/composition\/(api|worker)\/src\/(.+)$/,
  );
  if (composition) {
    return { kind: "enterprise-composition", relative: composition[2], workspacePath };
  }
  return undefined;
}

/**
 * A composition seam: `*.composition.ts` in the applications and
 * `*-composition.build.ts` inside a module, both building the connection a
 * process holds from the settings `platform/config/` reads.
 */
function isCompositionClickhouseSeam(relativePath) {
  if (relativePath.endsWith(".composition.ts")) return true;
  if (relativePath.endsWith("-composition.build.ts")) return true;
  if (relativePath.endsWith(".mount.ts")) return true;
  if (relativePath.startsWith("platform/infrastructure/")) return true;
  return relativePath.startsWith("platform/config/");
}

function isStrictClickhouseAdapter(pkg) {
  if (BOOT_MEMBERS_FILE.test(pkg.relative)) return true;
  if (isCompositionClickhouseSeam(pkg.relative)) return true;
  if (pkg.kind === "application" || pkg.kind === "enterprise-composition") {
    return pkg.relative.endsWith(".adapter.ts");
  }
  if (pkg.kind !== "process") return false;
  if (pkg.relative.startsWith("repositories/clickhouse/")) return true;
  // Named for the store it wraps: `postgres.*.adapter.ts` reaching for
  // ClickHouse is the leak this rule exists to catch, not a second seam.
  return /^adapters\/clickhouse\.[^/]+\.adapter\.ts$/.test(pkg.relative);
}

/** Whether a specifier names a ClickHouse client, including its subpaths. */
function isClickhouseSpecifier(specifier) {
  if (specifier === CLICKHOUSE_DRIVER || specifier.startsWith(`${CLICKHOUSE_DRIVER}/`)) return true;
  return specifier === CLICKHOUSE_CLIENT || specifier.startsWith(`${CLICKHOUSE_CLIENT}/`);
}

function importedSpecifier(node) {
  if (node.type === "ImportExpression") {
    return node.source?.type === "Literal" ? node.source.value : undefined;
  }
  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

/** Whether an import/export node binds a value, not only a type. */
function hasValueBinding(node) {
  if (node.type === "ImportExpression") return true;
  if (node.importKind === "type") return false;
  if (node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") {
    return node.exportKind !== "type";
  }
  return (node.specifiers ?? []).some((specifier) => specifier.importKind !== "type");
}

export const clickhouseContainmentRule = defineRule({
  name: "clickhouse-containment",
  kind: "problem",
  messages: {
    clickhouseClient: {
      what: "`{{name}}` is value-imported outside a ClickHouse repository, adapter or composition root.",
      fix: "Move the query into a `repositories/clickhouse/*.repository.ts` file and call it through the service. If this file only ever needed the type, change the import to `import type` instead.",
    },
  },
  create(context, file) {
    if (!file.isProduction) return {};
    if (CLICKHOUSE_NATIVE_PACKAGE.test(file.workspacePath)) return {};
    const pkg = clickhousePackageOf(file.workspacePath);
    if (!pkg) return {};
    if (isStrictClickhouseAdapter(pkg)) return {};

    const check = (node) => {
      const specifier = importedSpecifier(node);
      if (typeof specifier !== "string" || !isClickhouseSpecifier(specifier)) return;
      if (hasValueBinding(node)) {
        context.report({ node, messageId: "clickhouseClient", data: { name: specifier } });
      }
    };

    return {
      ImportDeclaration: check,
      ImportExpression: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
});
