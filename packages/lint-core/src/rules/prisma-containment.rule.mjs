import { defineRule } from "../define-rule.mjs";

const PRISMA_ROOT = "@langwatch/prisma-client";
const PRISMA_GENERATED = "@langwatch/prisma-client/generated";
const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);

/**
 * The package a file belongs to, for the boundary rules that ask what kind
 * of package they are standing in. `relative` is deliberately unprefixed
 * (unlike `classify`'s feature-package `relative`, which keeps `src/`), since
 * the composition-seam checks below match against `*.composition.ts` and
 * `platform/infrastructure/` at the package root.
 */
function prismaPackageOf(workspacePath) {
  const feature = workspacePath.match(
    /^packages\/(enterprise\/)?features\/([^/]+)\/(contract|server|web)\/src\/(.+)$/,
  );
  if (feature) {
    return { kind: feature[3], feature: feature[2], relative: feature[4], workspacePath };
  }
  const application = workspacePath.match(/^apps\/([^/]+)\/src\/(.+)$/);
  if (application && APPLICATION_ROOTS.has(application[1])) {
    return { kind: "application", relative: application[2], workspacePath };
  }
  const composition = workspacePath.match(
    /^packages\/enterprise\/composition\/(api|worker)\/src\/(.+)$/,
  );
  if (composition) {
    return { kind: "enterprise-composition", relative: composition[2], workspacePath };
  }
  const shared = workspacePath.match(/^packages\/(config|design-system)\/src\/(.+)$/);
  if (shared) return { kind: shared[1], relative: shared[2], workspacePath };
  return undefined;
}

function isPrismaProductionSource(relativePath) {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  const segments = relativePath.split("/");
  return !segments.includes("__tests__") && !segments.includes("__mocks__");
}

function isCompositionPrismaSeam(relativePath) {
  if (/\.composition\.ts$/.test(relativePath)) return true;
  if (/\.mount\.ts$/.test(relativePath)) return true;
  if (/\.adapter\.ts$/.test(relativePath)) return true;
  return relativePath.startsWith("platform/infrastructure/");
}

function isStrictPrismaAdapter(pkg) {
  if (pkg.kind === "application" || pkg.kind === "enterprise-composition") {
    return isCompositionPrismaSeam(pkg.relative);
  }
  if (pkg.kind !== "server") return false;
  if (pkg.relative.startsWith("repositories/prisma/")) return true;
  return /^adapters\/postgres\.[^/]+\.adapter\.ts$/.test(pkg.relative);
}

function importedSpecifier(node) {
  if (node.type === "ImportExpression") {
    return node.source?.type === "Literal" ? node.source.value : undefined;
  }
  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

export const prismaContainmentRule = defineRule({
  name: "prisma-containment",
  kind: "problem",
  messages: {
    generatedPrisma: {
      what: "Generated Prisma may only be imported by a repository under server/src/repositories/prisma or the Postgres composition adapter (server/src/adapters/postgres.<subject>.adapter.ts).",
      fix: "Move the query into a `*.repository.ts` there and call it through the service.",
    },
    featurePrismaClient: {
      what: "Feature packages cannot own Prisma connection or lifecycle services.",
      fix: "Import `PrismaClient` as a type only and take the instance from the composition root; features do not own connections.",
    },
  },
  create(context, file) {
    const pkg = prismaPackageOf(file.workspacePath);
    if (!pkg || !isPrismaProductionSource(pkg.relative)) return {};
    const adapter = isStrictPrismaAdapter(pkg);

    const check = (node) => {
      const specifier = importedSpecifier(node);
      if (typeof specifier !== "string") return;
      const generated =
        specifier === PRISMA_GENERATED || specifier.startsWith(`${PRISMA_GENERATED}/`);
      if (generated && !adapter) {
        context.report({ node, messageId: "generatedPrisma" });
      }
      if (pkg.feature && specifier === PRISMA_ROOT) {
        context.report({ node, messageId: "featurePrismaClient" });
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
