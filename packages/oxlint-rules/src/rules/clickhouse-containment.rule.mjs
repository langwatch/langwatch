import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// ClickHouse gets the same containment Prisma has (see prisma-containment):
// only the repository that owns a table, or the composition root that builds
// the one connection a process holds, may value-import the client package.
// Everywhere else asks for the query through a service, the way the rest of
// the codebase already does for Postgres.

const CLICKHOUSE_CLIENT = "@langwatch/clickhouse-client";
const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);
// The process-boot files that actually construct or shut down the client:
// `<app>-clickhouse.members.ts`, `<app>-clickhouse.infrastructure.ts`,
// `clickhouse-member.ts` and friends. Named by convention, not by folder, so
// the allowance follows the file wherever it is built.
const BOOT_MEMBERS_FILE = /(?:\.members\.ts|-member\.ts|\.infrastructure\.ts)$/;

/**
 * The package a file belongs to, for the boundary rule that asks what kind of
 * package it is standing in. Mirrors `prisma-containment`'s own
 * `prismaPackageOf`, with `packages/infrastructure` recognised as a shared
 * root in place of Prisma's `config`/`design-system` since that is where the
 * boot-time ClickHouse construction for shared members actually lives.
 */
function clickhousePackageOf(workspacePath) {
  const feature = workspacePath.match(
    /^(enterprise\/)?modules\/([^/]+)\/(contract|server|web)\/src\/(.+)$/,
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
  const shared = workspacePath.match(/^packages\/infrastructure\/src\/(.+)$/);
  if (shared) return { kind: "infrastructure", relative: shared[1], workspacePath };
  return undefined;
}

function isCompositionClickhouseSeam(relativePath) {
  if (/\.composition\.ts$/.test(relativePath)) return true;
  if (/\.mount\.ts$/.test(relativePath)) return true;
  if (/\.adapter\.ts$/.test(relativePath)) return true;
  return relativePath.startsWith("platform/infrastructure/");
}

function isStrictClickhouseAdapter(pkg) {
  if (BOOT_MEMBERS_FILE.test(pkg.relative)) return true;
  if (pkg.kind === "application" || pkg.kind === "enterprise-composition") {
    return isCompositionClickhouseSeam(pkg.relative);
  }
  if (pkg.kind !== "server") return false;
  if (pkg.relative.startsWith("repositories/clickhouse/")) return true;
  return /^adapters\/clickhouse\.[^/]+\.adapter\.ts$/.test(pkg.relative);
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
      what: "`@langwatch/clickhouse-client` is value-imported outside a ClickHouse repository or adapter.",
      fix: "Move the query into a `repositories/clickhouse/*.repository.ts` file and call it through the service, or import the type only.",
    },
  },
  create(context, file) {
    if (!file.isProduction) return {};
    const pkg = clickhousePackageOf(file.workspacePath);
    if (!pkg) return {};
    if (isStrictClickhouseAdapter(pkg)) return {};
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "clickhouse-containment" })) {
      return {};
    }

    const check = (node) => {
      const specifier = importedSpecifier(node);
      if (specifier !== CLICKHOUSE_CLIENT) return;
      if (hasValueBinding(node)) {
        context.report({ node, messageId: "clickhouseClient" });
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
