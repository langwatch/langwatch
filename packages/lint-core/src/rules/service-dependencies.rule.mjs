import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { defineRule } from "../define-rule.mjs";

function serviceSubject(filename) {
  const name = basename(filename);
  return name.endsWith(".service.ts") ? name.slice(0, -".service.ts".length) : undefined;
}

function serviceOwnerRoot(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  const feature = normalized.match(
    /^(packages\/(?:enterprise\/)?features\/[^/]+\/server)\/src\/services\//,
  );
  if (feature) return resolve(cwd, feature[1]);
  const application = normalized.match(/^(apps\/(?:api|worker|ui)\/src\/[^/]+)\//);
  return application ? resolve(cwd, application[1]) : dirname(filename);
}

function repositoryTarget(specifier, filename) {
  if (specifier.startsWith(".")) return resolve(dirname(filename), specifier);
  // `~/` was the deleted platform application's alias root. It resolves to
  // nothing now; returning undefined is what makes an import that still uses it
  // unresolvable rather than silently pointed at a path that is not there.
  return undefined;
}

function importedName(specifier) {
  if (specifier.type === "ImportSpecifier") {
    return specifier.imported.name ?? specifier.imported.value;
  }
  return specifier.local?.name;
}

function importsRepository(node) {
  const pathNamesRepository = node.source.value
    .split("/")
    .at(-1)
    ?.replace(/\.[cm]?[jt]s$/, "")
    .endsWith(".repository");
  return (
    pathNamesRepository ||
    node.specifiers.some((specifier) => importedName(specifier)?.endsWith("Repository"))
  );
}

function importsDatabaseClient(node) {
  const specifier = node.source.value;
  return (
    specifier === "@prisma/client" ||
    specifier === "@clickhouse/client" ||
    specifier === "ioredis" ||
    specifier === "redis" ||
    /(?:generated\/prisma|prisma\/client|\/clickhouse(?:\/|$)|\/redis(?:\/|$)|\/db(?:\/|$))/.test(
      specifier,
    ) ||
    node.specifiers.some((item) =>
      /(?:PrismaClient|ClickHouseClient|RedisClient)$/.test(importedName(item) ?? ""),
    )
  );
}

function importsGlobalApplication(node) {
  return (
    /(?:^|\/)app-layer\/app$/.test(node.source.value) ||
    node.specifiers.some((item) =>
      /^(?:getApp|tryGetApp|initializeApp)$/.test(importedName(item) ?? ""),
    )
  );
}

function escapesRoot(root, target) {
  const path = relative(root, target);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

export const serviceDependenciesRule = defineRule({
  name: "service-dependencies",
  kind: "problem",
  messages: {
    databaseClient: {
      what: "A service cannot import a database client; persistence belongs behind its own repository.",
      fix: "Move the import behind a `*.repository.ts` and depend on that instead.",
    },
    foreignRepository: {
      what: "`{{specifier}}` is another subject's repository.",
      fix: "Depend on that subject's service instead; a service owns only its own repository.",
    },
    globalApplication: {
      what: "A service cannot recover the global application graph.",
      fix: "Inject the service dependency explicitly.",
    },
  },
  create(context) {
    const filename = context.physicalFilename || context.filename;
    const absoluteFilename = isAbsolute(filename) ? filename : resolve(context.cwd, filename);
    const subject = serviceSubject(absoluteFilename);
    if (!subject) return {};
    const ownerRoot = serviceOwnerRoot(absoluteFilename, context.cwd);

    return {
      ImportDeclaration(node) {
        if (importsDatabaseClient(node)) {
          context.report({ node: node.source, messageId: "databaseClient" });
        }
        if (importsGlobalApplication(node)) {
          context.report({ node: node.source, messageId: "globalApplication" });
        }
        if (!importsRepository(node)) return;
        const target = repositoryTarget(node.source.value, absoluteFilename);
        if (!target || escapesRoot(ownerRoot, target)) {
          context.report({
            node: node.source,
            messageId: "foreignRepository",
            data: { specifier: node.source.value },
          });
        }
      },
    };
  },
});
