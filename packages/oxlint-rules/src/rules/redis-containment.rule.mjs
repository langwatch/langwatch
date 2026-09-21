import { defineRule } from "../define-rule.mjs";

// Redis gets the containment Prisma and ClickHouse already have: only the
// repository owning a key space, the adapter beside it, or the composition root
// building the one connection a process holds, may value-import a client. A
// service opening its own gives the module two paths to its data, one unswappable.

const REDIS_CLIENT = "@langwatch/redis-client";
const REDIS_DRIVER = "ioredis";
const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);
const BOOT_MEMBERS_FILE = /(?:\.members\.ts|-member\.ts|-members\.ts|\.infrastructure\.ts)$/;
// Packages whose whole job is Redis: the client wrapper, the boot-time member
// construction, the test harness, and the group queue - a Redis-native queue
// library where the driver is the domain rather than a leak out of one.
const REDIS_NATIVE_PACKAGE =
  /^packages\/(?:redis-client|process-stores|test-harness|group-queue)\//;

/**
 * The package a file belongs to, for the boundary rule that asks what kind of
 * package it is standing in. Mirrors `clickhouseContainmentRule`'s own
 * `clickhousePackageOf`.
 */
function redisPackageOf(workspacePath) {
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
 * A composition seam. This tree spells composition roots two ways -
 * `*.composition.ts` in the applications and `*-composition.build.ts` inside a
 * module - and both build the connection a process holds.
 */
function isCompositionRedisSeam(relativePath) {
  if (relativePath.endsWith(".composition.ts")) return true;
  if (relativePath.endsWith("-composition.build.ts")) return true;
  if (relativePath.endsWith(".mount.ts")) return true;
  if (relativePath.startsWith("platform/infrastructure/")) return true;
  return relativePath.startsWith("platform/config/");
}

function isStrictRedisAdapter(pkg) {
  if (BOOT_MEMBERS_FILE.test(pkg.relative)) return true;
  if (isCompositionRedisSeam(pkg.relative)) return true;
  if (pkg.kind === "application" || pkg.kind === "enterprise-composition") {
    return pkg.relative.endsWith(".adapter.ts");
  }
  if (pkg.kind !== "process") return false;
  if (pkg.relative.startsWith("repositories/redis/")) return true;
  // Named for the store it wraps: `postgres.*.adapter.ts` reaching for Redis is
  // the leak this rule exists to catch, not a second seam.
  return /^adapters\/redis\.[^/]+\.adapter\.ts$/.test(pkg.relative);
}

/** Whether a specifier names a Redis client, including its subpaths. */
function isRedisSpecifier(specifier) {
  if (specifier === REDIS_DRIVER || specifier.startsWith(`${REDIS_DRIVER}/`)) return true;
  return specifier === REDIS_CLIENT || specifier.startsWith(`${REDIS_CLIENT}/`);
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

export const redisContainmentRule = defineRule({
  name: "redis-containment",
  kind: "problem",
  messages: {
    redisClient: {
      what: "`{{name}}` is value-imported outside a Redis repository, adapter or composition root.",
      fix: "Move the command into a `repositories/redis/*.repository.ts` file and call it through the service. If this file only ever needed the type, change the import to `import type` instead.",
    },
  },
  create(context, file) {
    if (!file.isProduction) return {};
    if (REDIS_NATIVE_PACKAGE.test(file.workspacePath)) return {};
    const pkg = redisPackageOf(file.workspacePath);
    if (!pkg) return {};
    if (isStrictRedisAdapter(pkg)) return {};

    const check = (node) => {
      const specifier = importedSpecifier(node);
      if (typeof specifier !== "string" || !isRedisSpecifier(specifier)) return;
      if (hasValueBinding(node)) {
        context.report({ node, messageId: "redisClient", data: { name: specifier } });
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
