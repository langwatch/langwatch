import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { modulePackageOf } from "../classify.mjs";
import { defineRule } from "../define-rule.mjs";

// Which workspace package may import which, read off the module tree the
// classifier discovers. The shape it enforces is ARCHITECTURE.md §2, §3 and §3.4.

const APPLICATION = /^apps\/[^/]+\//;
const NODE_RUNTIME = /^node:/;
const BROWSER_RUNTIME =
  /^(?:react|react-dom|@chakra-ui\/|@langwatch\/(?:browser-host|browser-trpc|design-system|ui-kernel)(?:\/|$))/;
const SERVER_RUNTIME =
  /^(?:hono|@trpc\/server|@langwatch\/(?:eventing|group-queue|process-server|process-stores)(?:\/|$))/;
const KIT_FETCH = /^@langwatch\/browser-trpc(?:\/|$)/;
const SCHEMA_BINDING = new Set(["@hono/zod-validator", "hono-openapi/zod"]);
const BROWSER_ROLES = new Set(["browser", "browser-kit"]);

const RETIRED_PACKAGE_ENTRYPOINTS = new Map([
  ["zod/v3", "zod"],
  [
    "@langwatch/automations",
    "@langwatch/automation-contract, @langwatch/automation-process, or @langwatch/automation-browser",
  ],
  ["@ee", "the owning module's `@langwatch/enterprise-<module>-contract`"],
]);

const packageRootCache = new Map();

function remember(visited, root) {
  for (const seen of visited) packageRootCache.set(seen, root);

  return root ?? undefined;
}

function isOutside(cwd, directory) {
  const parent = dirname(directory);

  return parent === directory || relative(cwd, parent).startsWith("..");
}

/** The nearest package.json above the file, so every workspace member is held. */
function packageRootForFile(filename, cwd) {
  let directory = dirname(resolve(cwd, filename));
  const visited = [];
  for (;;) {
    const cached = packageRootCache.get(directory);
    if (cached !== undefined) return remember(visited, cached);
    visited.push(directory);
    if (existsSync(join(directory, "package.json"))) return remember(visited, directory);
    if (isOutside(cwd, directory)) return remember(visited, null);
    directory = dirname(directory);
  }
}

function retiredReplacement(specifier) {
  for (const [retired, replacement] of RETIRED_PACKAGE_ENTRYPOINTS) {
    if (specifier === retired || specifier.startsWith(`${retired}/`)) return replacement;
  }

  return undefined;
}

function workspaceRelative(cwd, path) {
  return relative(cwd, path).split(sep).join("/");
}

function escapeFinding(file, specifier, cwd) {
  const packageRoot = packageRootForFile(file.filename, cwd);
  if (!packageRoot) return undefined;
  const targetPath = resolve(dirname(file.filename), specifier);
  if (!relative(packageRoot, targetPath).startsWith("..")) return undefined;

  const targetRoot = packageRootForFile(targetPath, cwd);
  const intoAMember = targetRoot !== undefined && targetRoot !== packageRoot && targetRoot !== cwd;

  return {
    messageId: intoAMember ? "packageEscape" : "unownedEscape",
    data: { specifier, packageRoot: workspaceRelative(cwd, packageRoot) },
  };
}

function runtimeFinding(file, specifier) {
  if (file.isTest) return undefined;
  const node = NODE_RUNTIME.test(specifier);
  const server = SERVER_RUNTIME.test(specifier);
  const browser = BROWSER_RUNTIME.test(specifier);
  if (file.role === "contract" && (node || server || browser)) return "contractRuntime";
  if (BROWSER_ROLES.has(file.role) && (node || server)) return "browserImportsProcess";
  if (file.role === "process" && browser) return "processImportsBrowser";
  if (file.role === "browser-kit" && KIT_FETCH.test(specifier)) return "kitFetches";

  return undefined;
}

function directionFinding(file, target) {
  if (file.role === "contract" && target.role !== "contract") return "contractRuntime";
  if (BROWSER_ROLES.has(file.role) && target.role === "process") return "browserImportsProcess";
  if (file.role === "process" && BROWSER_ROLES.has(target.role)) return "processImportsBrowser";
  const kitReachesABrowser =
    file.role === "browser-kit" &&
    BROWSER_ROLES.has(target.role) &&
    target.root !== kitRootOf(file);

  return kitReachesABrowser ? "kitLeaf" : undefined;
}

function kitRootOf(file) {
  return `${file.moduleEnterprise ? "enterprise/" : ""}modules/${file.module}/browser-kit`;
}

function pascalCase(kebab) {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function camelCase(kebab) {
  const pascal = pascalCase(kebab);

  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function importedNames(node) {
  const specifiers = node.parent?.type === "ImportDeclaration" ? node.parent.specifiers : [];

  return specifiers.map((entry) =>
    entry.type === "ImportSpecifier" && entry.imported.type === "Identifier"
      ? entry.imported.name
      : undefined,
  );
}

/** §13: an installation test installs its peers' process modules for real. */
function isPeerInstallation(file, target, subpath, node) {
  if (!file.isTest || subpath !== ".") return false;
  const installers = new Set([
    `${camelCase(target.module)}Server`,
    `${camelCase(target.module)}ProcessModule`,
  ]);
  const names = importedNames(node);

  return names.length > 0 && names.every((name) => installers.has(name));
}

function isTestSeam(file, subpath, target) {
  return file.isTest && subpath === "./testing" && target.exports.has(subpath);
}

function peerData(target) {
  const prefix = target.enterprise ? "enterprise-" : "";

  return {
    api: `${pascalCase(target.module)}Api`,
    contract: `@langwatch/${prefix}${target.module}-contract`,
    kit: `@langwatch/${prefix}${target.module}-browser-kit`,
    module: target.module,
  };
}

function crossModuleFinding(file, target, subpath, node) {
  if (target.role === "contract" || target.module === file.module) return undefined;
  if (target.role === "browser-kit" && BROWSER_ROLES.has(file.role)) return undefined;
  if (isTestSeam(file, subpath, target) || isPeerInstallation(file, target, subpath, node)) {
    return undefined;
  }

  return target.role === "process" ? "crossModuleProcess" : "crossModuleBrowser";
}

function outsideModuleFinding(file, target, subpath) {
  if (target.role === "process") {
    if (isTestSeam(file, subpath, target)) return undefined;

    return APPLICATION.test(file.workspacePath) ? "compositionRoot" : "processOutsideModule";
  }
  if (
    target.role === "browser" &&
    subpath !== "./declaration" &&
    !isTestSeam(file, subpath, target)
  ) {
    return "browserSideDoor";
  }

  return undefined;
}

function ownershipFinding(file, target, subpath, node) {
  if (file.module) return crossModuleFinding(file, target, subpath, node);

  return outsideModuleFinding(file, target, subpath);
}

function isCoreSource(file) {
  return !file.enterprise && file.role !== "other";
}

function packageFindings(file, specifier, cwd, node) {
  const found = modulePackageOf(cwd, specifier);
  if (!found) return [];
  const { pkg: target, subpath } = found;
  const findings = [];
  if (!target.exports.has(subpath)) {
    findings.push({ messageId: "sealedExports", data: { subpath, package: target.name } });
  }
  const shape = directionFinding(file, target) ?? ownershipFinding(file, target, subpath, node);
  if (shape) findings.push({ messageId: shape, data: { specifier, ...peerData(target) } });
  if (isCoreSource(file) && target.enterprise && target.role !== "contract") {
    findings.push({ messageId: "coreImportsEnterprise", data: { specifier } });
  }

  return findings;
}

function specifierFindings(file, specifier, cwd, node) {
  const replacement = retiredReplacement(specifier);
  if (replacement)
    return [{ messageId: "retiredPackageRuntime", data: { specifier, replacement } }];

  const findings = [];
  if (specifier.startsWith(".")) {
    const escape = escapeFinding(file, specifier, cwd);
    if (escape) findings.push(escape);
  }
  findings.push(...packageFindings(file, specifier, cwd, node));
  if (file.module && SCHEMA_BINDING.has(specifier)) {
    findings.push({ messageId: "schemaBoundary", data: { specifier } });
  }
  const runtime = runtimeFinding(file, specifier);
  if (runtime) findings.push({ messageId: runtime, data: { specifier } });

  return findings;
}

export const boundaryRule = defineRule({
  name: "package-boundaries",
  kind: "problem",
  messages: {
    compositionRoot: {
      what: "`{{specifier}}` is `{{module}}`'s process package, and an application composes modules without naming one.",
      fix: "Take `{{module}}` from the generated `@langwatch/installed-server-modules` list (catalogue-driven, `pnpm generate:modules`), and move whatever this root builds from `{{specifier}}` behind the module's own declaration so the module constructs it.",
    },
    processOutsideModule: {
      what: "`{{specifier}}` is `{{module}}`'s process package, and only `{{module}}` itself may import it.",
      fix: "Call `{{api}}` from `{{contract}}` instead; if the operation is not there, it is a new `{{api}}` operation to propose to the module's owner.",
    },
    crossModuleProcess: {
      what: "`{{specifier}}` is another module's process package.",
      fix: "Call `{{api}}` from `{{contract}}` instead; if the operation is not there, it is a new `{{api}}` operation to propose to the module's owner.",
    },
    crossModuleBrowser: {
      what: "`{{specifier}}` is `{{module}}`'s browser package, which is closed to every other module.",
      fix: "Move what this needs into `{{kit}}` and import it from there; where fewer than two modules share it, inline it here instead (the kit law, ARCHITECTURE.md §3.4).",
    },
    browserSideDoor: {
      what: "`{{specifier}}` reaches past `{{module}}`'s browser declaration, the only door a browser package has.",
      fix: "Import `@langwatch/{{module}}-browser/declaration` and read the capability from its `withCapabilities` slot, or move a shared component into `{{kit}}`.",
    },
    kitLeaf: {
      what: "`{{specifier}}` is a browser package, and a browser kit is a leaf.",
      fix: "Import only contracts, `@langwatch/design-system` and `@langwatch/browser-host` here; take what `{{specifier}}` provides as a prop from the consumer.",
    },
    kitFetches: {
      what: "`{{specifier}}` fetches, and a browser kit fetches nothing.",
      fix: "Take the data as a prop (`options`, `value`, `onChange`) and let each consumer run its own query.",
    },
    packageEscape: {
      what: "`{{specifier}}` resolves outside `{{packageRoot}}`, so this package depends on a file it does not own.",
      fix: "Replace `{{specifier}}` with the target's package name — `@langwatch/<module>-<contract|process|browser|browser-kit>` for a module package, `@langwatch/<name>` for any other workspace package. Move the file into `{{packageRoot}}` instead only when nothing outside `{{packageRoot}}` imports it.",
    },
    unownedEscape: {
      what: "`{{specifier}}` resolves outside `{{packageRoot}}` into a directory no package owns, so nothing records that this package depends on it.",
      fix: "Give the target directory a `package.json` and add it to `pnpm-workspace.yaml`, then import it by that name — the way `dev/scripts` became `@langwatch/dev-scripts`. Move the file into `{{packageRoot}}` instead when only this package reads it.",
    },
    contractRuntime: {
      what: "A contract package is runtime-neutral: `{{specifier}}` is a node, browser or process runtime.",
      fix: "Keep only schemas, types, errors and the `*Api` token here; move the code that needs `{{specifier}}` into this module's process package, or into its browser package when it is a browser import.",
    },
    browserImportsProcess: {
      what: "`{{specifier}}` is process-only, and this is a browser package.",
      fix: "Call the procedure through this module's derived tRPC client, and import any shared type from the owning module's contract.",
    },
    processImportsBrowser: {
      what: "`{{specifier}}` is browser-only, and this is a process package.",
      fix: "Move the browser-only code into this module's browser package; share a type through the contract.",
    },
    coreImportsEnterprise: {
      what: "`{{specifier}}` is an enterprise module's implementation, and this is core code.",
      fix: "Depend on that module's peer `*Api` from its contract instead; the enterprise module installs like any other and the process resolves the peer (ARCHITECTURE.md §11).",
    },
    retiredPackageRuntime: {
      what: "`{{specifier}}` is a retired runtime or package entry point.",
      fix: "Import {{replacement}} instead.",
    },
    schemaBoundary: {
      what: "`{{specifier}}` binds the module to Hono.",
      fix: "Export a plain Zod schema from the contract and let the transport adapt it.",
    },
    sealedExports: {
      what: "`{{subpath}}` is not in `{{package}}`'s `exports`.",
      fix: 'Import from `{{package}}` itself when its entry already re-exports the symbol. A browser package exports only `./declaration` and a kit only `.`, so there the symbol is private; for a contract or process package, add `"{{subpath}}"` to its `exports` and re-export the symbol from that entry.',
    },
  },
  create(context, file) {
    const check = (node) => {
      if (typeof node?.value !== "string") return;
      for (const finding of specifierFindings(file, node.value, context.cwd, node)) {
        context.report({ node, ...finding });
      }
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        const isRequire = node.callee.type === "Identifier" && node.callee.name === "require";
        if (isRequire) check(node.arguments[0]);
      },
    };
  },
});
