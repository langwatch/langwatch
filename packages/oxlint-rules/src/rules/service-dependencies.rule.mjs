import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { defineRule } from "../define-rule.mjs";

function serviceSubject(filename) {
  const name = basename(filename);
  return name.endsWith(".service.ts") ? name.slice(0, -".service.ts".length) : undefined;
}

function serviceOwnerRoot(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  const feature = normalized.match(/^((?:enterprise\/)?modules\/[^/]+\/server)\/src\/services\//);
  if (feature) return resolve(cwd, feature[1]);
  const application = normalized.match(/^(apps\/(?:api|worker|ui)\/src\/[^/]+)\//);
  return application ? resolve(cwd, application[1]) : dirname(filename);
}

function repositoryTarget(specifier, filename) {
  if (specifier.startsWith("#repositories/")) return filename;
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

// "Repository" -> "Repository" (already PascalCase, keep); "project" -> "Project".
function toPascal(word) {
  if (!word) return undefined;
  if (/^[A-Z]/.test(word)) return word;
  return word
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// The repository's own subject, read off whichever half of the import named
// it: the file path (`.../project.repository`) or the imported symbol
// (`ProjectRepository`). Used to name the exact service to depend on instead.
function foreignSubjectOf(node) {
  const pathBase = node.source.value
    .split("/")
    .at(-1)
    ?.replace(/\.[cm]?[jt]s$/, "");
  if (pathBase?.endsWith(".repository")) return pathBase.slice(0, -".repository".length);

  const named = node.specifiers.find((specifier) => importedName(specifier)?.endsWith("Repository"));
  const name = named ? importedName(named) : undefined;
  return name ? name.slice(0, -"Repository".length) : undefined;
}

export const serviceDependenciesRule = defineRule({
  name: "service-dependencies",
  kind: "problem",
  messages: {
    databaseClient: {
      what: "`{{specifier}}` is a database client; persistence belongs behind its own repository.",
      fix: "Move the import into `repositories/{{subject}}.repository.ts` and depend on that instead.",
    },
    foreignRepository: {
      what: "`{{specifier}}` is another subject's repository.",
      fix: "{{fixInstruction}}",
    },
    globalApplication: {
      what: "`{{name}}` recovers the global application graph from inside a service.",
      fix: "Take the dependency as a parameter to the service's constructor or `create()` factory instead of calling `{{name}}()`.",
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
          context.report({
            node: node.source,
            messageId: "databaseClient",
            data: { specifier: node.source.value, subject },
          });
        }
        if (importsGlobalApplication(node)) {
          const global = node.specifiers.find((specifier) =>
            /^(?:getApp|tryGetApp|initializeApp)$/.test(importedName(specifier) ?? ""),
          );
          const name = global ? importedName(global) : "getApp";
          context.report({ node: node.source, messageId: "globalApplication", data: { name } });
        }
        if (!importsRepository(node)) return;
        const target = repositoryTarget(node.source.value, absoluteFilename);
        const foreignRepository = !target || escapesRoot(ownerRoot, target);
        if (foreignRepository) {
          const suggestedService = toPascal(foreignSubjectOf(node));
          const fixInstruction = suggestedService
            ? `Depend on \`${suggestedService}Service\` instead; a service owns only its own repository.`
            : "Depend on that subject's service instead; a service owns only its own repository.";
          context.report({
            node: node.source,
            messageId: "foreignRepository",
            data: { fixInstruction, specifier: node.source.value },
          });
        }
      },
    };
  },
});
