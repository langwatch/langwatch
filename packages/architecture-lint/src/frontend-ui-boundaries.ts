import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const UI_FEATURE_CATALOGUE_PATH = join("apps", "ui", "src", "features", "catalogue.json");
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SOURCE_EXTENSION_CANDIDATES = [".ts", ".tsx", ".mts", ".mtsx", ".js", ".jsx"];
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier.replace(/^node:/, "")}`]),
);
const UI_SOURCE_DIRECTORIES = new Set(["app", "features", "platform", "testing"]);
const SURFACE_FORBIDDEN_DIRECTORIES = new Set([
  "internal",
  "queries",
  "routes",
  "screens",
  "state",
  "stores",
  "transport",
]);

const featureUseSchema = z
  .object({
    screens: z.array(z.string()).default([]),
    surfaces: z.array(z.string()).default([]),
  })
  .strict();

const uiFeatureCatalogueSchema = z
  .object({
    version: z.literal(0),
    governedWebPackages: z.array(z.string().regex(/^@langwatch\/[a-z0-9-]+-web$/)),
    features: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
          root: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
          uses: featureUseSchema,
        })
        .strict(),
    ),
  })
  .strict();

type UiFeatureCatalogue = z.infer<typeof uiFeatureCatalogueSchema>;
type UiFeature = UiFeatureCatalogue["features"][number];

type SourceImport = {
  file: string;
  line: number;
  specifier: string;
  nonLiteral: boolean;
};

type Capability = {
  packageName: string;
  exportPath: string;
  kind: "screen" | "surface";
  id: string;
};

type WebPackage = ClassifiedPackage & { kind: "web"; feature: string };

const BROWSER_CAPABILITY_IMPORTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^@tanstack\/react-query(?:\/|$)/, "React Query directly"],
  [/^@trpc\/(?:client|react-query)(?:\/|$)/, "tRPC transport directly"],
  [/^(?:axios|ky|wretch)(?:\/|$)/, "an HTTP client directly"],
  [
    /^(?:react-router|react-router-dom|next\/navigation|next\/router)(?:\/|$)/,
    "router implementation directly",
  ],
  [/^(?:next-auth|better-auth)(?:\/|$)/, "session implementation directly"],
];

const BROWSER_CAPABILITY_SOURCE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAppRouter\b/, "AppRouter"],
  [/\bprocess\.env\b/, "process.env"],
  [/\bfetch\s*\(/, "fetch"],
  [/\b(?:XMLHttpRequest|WebSocket|EventSource)\b/, "a browser transport global"],
  [/\bnavigator\.sendBeacon\b/, "navigator.sendBeacon"],
  [/(?:\bwindow\.)?\blocation\.(?:assign|replace|href)\b/, "location navigation"],
  [/\b(?:localStorage|sessionStorage|document\.cookie)\b/, "browser session or storage state"],
];

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return !(
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  );
}

function importsIn(file: string): SourceImport[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: SourceImport[] = [];

  const addImport = (node: ts.Node, specifier: ts.Expression | undefined): void => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const isLiteral = specifier !== void 0 && ts.isStringLiteralLike(specifier);
    found.push({
      file,
      line: position.line + 1,
      specifier: isLiteral ? specifier.text : "<non-literal module specifier>",
      nonLiteral: !isLiteral,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addImport(node.moduleSpecifier, node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addImport(node.moduleSpecifier, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addImport(node.moduleReference, node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) addImport(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function sourceFiles(root: string): string[] {
  return walkFiles(
    root,
    (file) =>
      SOURCE_FILE.test(file) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
      !file.includes(`${sep}__tests__${sep}`) &&
      !file.includes(`${sep}__mocks__${sep}`),
  );
}

function resolveSourceCandidate(candidate: string): string | undefined {
  const candidates = [
    candidate,
    ...SOURCE_EXTENSION_CANDIDATES.map((extension) => `${candidate}${extension}`),
    ...SOURCE_EXTENSION_CANDIDATES.map((extension) => join(candidate, `index${extension}`)),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

function resolveRelativeSource(sourceImport: SourceImport): string | undefined {
  if (!sourceImport.specifier.startsWith(".")) return void 0;
  return resolveSourceCandidate(resolve(dirname(sourceImport.file), sourceImport.specifier));
}

function resolveUiSourceImport(sourceImport: SourceImport, sourceRoot: string): string | undefined {
  const relativeTarget = resolveRelativeSource(sourceImport);
  if (relativeTarget) return relativeTarget;
  if (!/^(?:~|@)\//.test(sourceImport.specifier)) return void 0;
  return resolveSourceCandidate(resolve(sourceRoot, sourceImport.specifier.slice(2)));
}

function readUiFeatureCatalogue(root: string): {
  catalogue: UiFeatureCatalogue | undefined;
  violations: ArchitectureViolation[];
} {
  const path = join(root, UI_FEATURE_CATALOGUE_PATH);
  if (!existsSync(path)) return { catalogue: void 0, violations: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      catalogue: void 0,
      violations: [
        {
          policy: "ui-feature-catalogue",
          file: path,
          message: `UI feature catalogue must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = uiFeatureCatalogueSchema.safeParse(parsed);
  if (!result.success) {
    return {
      catalogue: void 0,
      violations: [
        {
          policy: "ui-feature-catalogue",
          file: path,
          message: `UI feature catalogue must match version 0: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        },
      ],
    };
  }

  const identifiers = new Set<string>();
  const roots = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  const governedWebPackages = new Set<string>();
  for (const packageName of result.data.governedWebPackages) {
    if (governedWebPackages.has(packageName)) {
      violations.push({
        policy: "ui-feature-catalogue",
        file: path,
        message: `Governed web package names must be unique; ${JSON.stringify(packageName)} is repeated.`,
      });
    }
    governedWebPackages.add(packageName);
  }
  for (const feature of result.data.features) {
    if (identifiers.has(feature.id)) {
      violations.push({
        policy: "ui-feature-catalogue",
        file: path,
        message: `UI feature identifiers must be unique; ${JSON.stringify(feature.id)} is repeated.`,
      });
    }
    if (roots.has(feature.root)) {
      violations.push({
        policy: "ui-feature-catalogue",
        file: path,
        message: `UI feature roots must be unique; ${JSON.stringify(feature.root)} is repeated.`,
      });
    }
    identifiers.add(feature.id);
    roots.add(feature.root);
  }
  return { catalogue: result.data, violations };
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record = value as Record<string, unknown>;
  for (const key of ["default", "import", "types", "node"]) {
    const target = exportTarget(record[key]);
    if (target) return target;
  }
  return void 0;
}

function packageExports(pkg: WebPackage): Map<string, string> {
  if (!pkg.manifest.exports || typeof pkg.manifest.exports !== "object") return new Map();
  if (Array.isArray(pkg.manifest.exports)) return new Map();
  return new Map(
    Object.entries(pkg.manifest.exports as Record<string, unknown>)
      .map(([path, target]) => [path, exportTarget(target)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== void 0),
  );
}

function isTestOnlyExportTarget(target: string): boolean {
  return /(?:^|\/)(?:__tests__|__mocks__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(target);
}

function capabilityForSpecifier(
  webPackages: readonly WebPackage[],
  specifier: string,
): Capability | undefined {
  const pkg = webPackages
    .filter(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!pkg || specifier === pkg.name) return void 0;
  const exportPath = `./${specifier.slice(pkg.name.length + 1)}`;
  const match = exportPath.match(/^\.\/(screens|surfaces)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/);
  if (!match) return void 0;
  return {
    packageName: pkg.name,
    exportPath,
    kind: match[1] === "screens" ? "screen" : "surface",
    id: match[2]!,
  };
}

function webPackageForSpecifier(
  webPackages: readonly WebPackage[],
  specifier: string,
): WebPackage | undefined {
  return webPackages
    .filter(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
}

function featureForFile(uiFeaturesRoot: string, file: string): string | undefined {
  const path = relative(uiFeaturesRoot, file).split(sep);
  if (path.length < 2 || path[0] === ".." || path[0] === "catalogue.json") return void 0;
  return path[0];
}

function declaredUses(feature: UiFeature): Set<string> {
  return new Set([...feature.uses.screens, ...feature.uses.surfaces]);
}

function isForbiddenUiSpecifier(specifier: string): string | undefined {
  if (NODE_BUILTIN_SPECIFIERS.has(specifier)) {
    return "a Node.js builtin";
  }
  if (
    /^@langwatch\/(?:[^/]+-server|platform-api|server|worker)(?:\/|$)/.test(specifier) ||
    /^@langwatch\/prisma-client(?:\/|$)/.test(specifier) ||
    /^@prisma\//.test(specifier)
  ) {
    return "server, API, worker, or Prisma implementation";
  }
  if (/^(?:@app|@ee)(?:\/|$)/.test(specifier) || /(?:^|\/)platform\/app(?:\/|$)/.test(specifier)) {
    return "legacy platform/app implementation";
  }
  if (
    /^(?:~|@)\/(?:server|env)(?:\/|$)/.test(specifier) ||
    /^(?:~|@)\/utils\/env(?:\/|$)/.test(specifier) ||
    /(?:^|\/)env(?:\/|$)/.test(specifier)
  ) {
    return "environment module";
  }
  return void 0;
}

function forbiddenBrowserCapabilityImport(specifier: string): string | undefined {
  return BROWSER_CAPABILITY_IMPORTS.find(([pattern]) => pattern.test(specifier))?.[1];
}

function browserCapabilitySourceViolations(source: string): string[] {
  return BROWSER_CAPABILITY_SOURCE.filter(([pattern]) => pattern.test(source)).map(
    ([, description]) => description,
  );
}

function forbiddenWebPresentationImport(specifier: string): string | undefined {
  const forbiddenUiSpecifier = isForbiddenUiSpecifier(specifier);
  if (forbiddenUiSpecifier) return forbiddenUiSpecifier;
  const forbiddenCapability = forbiddenBrowserCapabilityImport(specifier);
  if (forbiddenCapability) return forbiddenCapability;
  if (/^(?:~|@)\//.test(specifier) || specifier.startsWith("#")) {
    return "an application or package source alias";
  }
  if (/^@langwatch\/[^/]+-web(?:\/|$)/.test(specifier)) {
    return "a feature-web public entry";
  }
  if (
    specifier.startsWith("@langwatch/") &&
    !/^@langwatch\/(?:design-system(?:\/|$)|[^/]+-contract(?:\/|$))/.test(specifier)
  ) {
    return "a first-party implementation package instead of a portable contract or the Design System";
  }
  return void 0;
}

function forbiddenFrontendFeatureImport(specifier: string): string | undefined {
  const forbiddenCapability = forbiddenBrowserCapabilityImport(specifier);
  if (forbiddenCapability) return forbiddenCapability;
  if (
    specifier.startsWith("@langwatch/") &&
    !/^@langwatch\/(?:design-system(?:\/|$)|[^/]+-(?:contract|web)(?:\/|$))/.test(specifier)
  ) {
    return "a first-party implementation package outside platform or a declared web capability";
  }
  return void 0;
}

function isLegacyApplicationRelativeImport(root: string, file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier);
  return isWithin(join(root, "platform", "app"), target);
}

function lintUiRootDirectories(root: string): ArchitectureViolation[] {
  const sourceRoot = join(root, "apps", "ui", "src");
  if (!existsSync(sourceRoot)) return [];
  return sourceFiles(sourceRoot).flatMap((file) => {
    const segments = relative(sourceRoot, file).split(sep);
    const isPackageEntry = segments.length === 1 && segments[0] === "index.ts";
    if (isPackageEntry || (segments.length > 1 && UI_SOURCE_DIRECTORIES.has(segments[0]!))) {
      return [];
    }
    return [
      {
        policy: "ui-root-catch-all",
        file,
        message: `apps/ui production source must live in app, platform, features, or testing; ${JSON.stringify(segments[0])} has no architectural owner.`,
        allowed:
          "Keep only the package entry at src/index.ts; place implementation in an approved source root.",
      },
    ];
  });
}

function lintUiFeatureRoots(root: string, catalogue: UiFeatureCatalogue): ArchitectureViolation[] {
  const featuresRoot = join(root, "apps", "ui", "src", "features");
  const declaredRoots = new Set(catalogue.features.map((feature) => feature.root));
  const violations: ArchitectureViolation[] = [];
  for (const feature of catalogue.features) {
    const path = join(featuresRoot, feature.root);
    if (!existsSync(path)) {
      violations.push({
        policy: "ui-feature-catalogue",
        file: join(root, UI_FEATURE_CATALOGUE_PATH),
        message: `UI feature ${JSON.stringify(feature.id)} declares missing root ${JSON.stringify(feature.root)}.`,
      });
    }
  }
  for (const file of sourceFiles(featuresRoot)) {
    const owner = featureForFile(featuresRoot, file);
    if (owner && !declaredRoots.has(owner)) {
      violations.push({
        policy: "ui-feature-catalogue",
        file,
        message: `Frontend feature root ${JSON.stringify(owner)} is not declared in the central UI feature catalogue.`,
      });
    }
  }
  return violations;
}

function lintDeclaredCapabilities(
  root: string,
  catalogue: UiFeatureCatalogue,
  webPackages: readonly WebPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const cataloguePath = join(root, UI_FEATURE_CATALOGUE_PATH);
  const governedWebPackages = new Set(catalogue.governedWebPackages);
  for (const feature of catalogue.features) {
    for (const [kind, specifiers] of [
      ["screen", feature.uses.screens],
      ["surface", feature.uses.surfaces],
    ] as const) {
      for (const specifier of specifiers) {
        const capability = capabilityForSpecifier(webPackages, specifier);
        const pkg = webPackageForSpecifier(webPackages, specifier);
        if (!capability || !pkg || !packageExports(pkg).has(capability.exportPath)) {
          violations.push({
            policy: "ui-web-capability-declaration",
            file: cataloguePath,
            specifier,
            message: `Declared ${kind} capability must name one exact exported screens/* or surfaces/* entry.`,
          });
          continue;
        }
        if (!governedWebPackages.has(pkg.name)) {
          violations.push({
            policy: "ui-web-package-governance",
            file: cataloguePath,
            specifier,
            message: `Declared ${kind} capability belongs to ungoverned web package ${JSON.stringify(pkg.name)}.`,
            allowed:
              "Add the package to governedWebPackages before a frontend feature consumes it.",
          });
        }
        if (capability.kind !== kind) {
          violations.push({
            policy: "ui-web-capability-declaration",
            file: cataloguePath,
            specifier,
            message: `Declared ${kind} capability names a ${capability.kind} export.`,
          });
        }
        if (capability.kind === "screen" && capability.id !== feature.id) {
          violations.push({
            policy: "ui-screen-owner",
            file: cataloguePath,
            specifier,
            message: `Screen owner ${JSON.stringify(capability.id)} does not match frontend feature ${JSON.stringify(feature.id)}.`,
          });
        }
      }
    }
  }
  return violations;
}

function lintGovernedWebPackages(
  root: string,
  catalogue: UiFeatureCatalogue,
  webPackages: readonly WebPackage[],
): ArchitectureViolation[] {
  const knownPackageNames = new Set(webPackages.map((pkg) => pkg.name));
  return catalogue.governedWebPackages.flatMap((packageName) =>
    knownPackageNames.has(packageName)
      ? []
      : [
          {
            policy: "ui-web-package-governance",
            file: join(root, UI_FEATURE_CATALOGUE_PATH),
            specifier: packageName,
            message: "Governed web package must be a discovered feature-web workspace package.",
          },
        ],
  );
}

function lintWebPublicExports(webPackages: readonly WebPackage[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of webPackages) {
    const exports = packageExports(pkg);
    for (const [exportPath, target] of exports) {
      if (isTestOnlyExportTarget(target)) continue;
      const capability = capabilityForSpecifier(webPackages, `${pkg.name}/${exportPath.slice(2)}`);
      if (!capability) {
        violations.push({
          policy: "ui-web-public-entry",
          file: pkg.manifestPath,
          specifier: exportPath,
          message:
            "Feature-web packages may expose only named screens/<owner> or surfaces/<id> entries during the UI feature pilot.",
          allowed: "Keep implementation private and name each cross-feature capability explicitly.",
        });
      }
    }
  }
  return violations;
}

function lintUiSourceBoundaries(
  root: string,
  catalogue: UiFeatureCatalogue,
  webPackages: readonly WebPackage[],
): ArchitectureViolation[] {
  const sourceRoot = join(root, "apps", "ui", "src");
  const featuresRoot = join(sourceRoot, "features");
  const featureByRoot = new Map(catalogue.features.map((feature) => [feature.root, feature]));
  const governedWebPackages = new Set(catalogue.governedWebPackages);
  const violations: ArchitectureViolation[] = [];
  const featureEdges = new Map<string, Set<string>>();

  for (const file of sourceFiles(sourceRoot)) {
    const importerFeatureRoot = featureForFile(featuresRoot, file);
    const importerFeature = importerFeatureRoot ? featureByRoot.get(importerFeatureRoot) : void 0;
    const source = readFileSync(file, "utf8");

    if (importerFeature) {
      for (const capability of browserCapabilitySourceViolations(source)) {
        if (capability === "AppRouter" || capability === "process.env") continue;
        violations.push({
          policy: "ui-browser-capability",
          file,
          message: `Frontend features may not use ${capability} directly.`,
          allowed: "Receive data and actions from an apps/ui platform capability.",
        });
      }
    }

    if (/\bAppRouter\b/.test(source)) {
      violations.push({
        policy: "ui-backend-access",
        file,
        message:
          "Browser UI may not reference AppRouter; define portable transport contracts instead.",
      });
    }
    if (/\bprocess\.env\b/.test(source)) {
      violations.push({
        policy: "ui-backend-access",
        file,
        message:
          "Browser UI may not read process.env; receive validated public configuration through platform composition.",
      });
    }

    for (const sourceImport of importsIn(file)) {
      if (sourceImport.nonLiteral) {
        violations.push({
          policy: "ui-static-module-specifier",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message:
            "Browser UI module imports and requires must use a statically analyzable literal.",
        });
        continue;
      }
      const forbidden =
        isForbiddenUiSpecifier(sourceImport.specifier) ??
        (isLegacyApplicationRelativeImport(root, file, sourceImport.specifier)
          ? "legacy platform/app implementation"
          : void 0);
      if (forbidden) {
        violations.push({
          policy: "ui-backend-access",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Browser UI may not import ${forbidden}.`,
        });
      }

      const forbiddenFeatureImport =
        importerFeature && !forbidden
          ? forbiddenFrontendFeatureImport(sourceImport.specifier)
          : void 0;
      if (forbiddenFeatureImport) {
        violations.push({
          policy: "ui-browser-capability",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Frontend features may not import ${forbiddenFeatureImport}.`,
          allowed: "Import a portable contract, a declared web capability, or apps/ui platform.",
        });
      }

      const target = resolveUiSourceImport(sourceImport, sourceRoot);
      if (target && !isWithin(sourceRoot, target)) {
        violations.push({
          policy: "ui-dependency-direction",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message:
            "apps/ui production source may not reach source outside apps/ui/src by file path.",
          allowed: "Import a portable workspace package through its public export.",
        });
      }
      if (target && isWithin(sourceRoot, target)) {
        const importerArea = relative(sourceRoot, file).split(sep)[0];
        const targetArea = relative(sourceRoot, target).split(sep)[0];
        if (importerArea === "platform" && (targetArea === "app" || targetArea === "features")) {
          violations.push({
            policy: "ui-dependency-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: "platform may not import app composition or product frontend features.",
          });
        }
        if (importerArea === "features" && targetArea === "app") {
          violations.push({
            policy: "ui-dependency-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: "A frontend feature may not import app composition.",
          });
        }
        if (importerFeatureRoot) {
          const targetFeatureRoot = featureForFile(featuresRoot, target);
          if (targetFeatureRoot && targetFeatureRoot !== importerFeatureRoot) {
            violations.push({
              policy: "ui-feature-implementation-import",
              file,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: `Frontend feature ${JSON.stringify(importerFeatureRoot)} may not import implementation from frontend feature ${JSON.stringify(targetFeatureRoot)}.`,
              allowed: "Use an explicit feature-web surface declared in the UI feature catalogue.",
            });
            const edges = featureEdges.get(importerFeatureRoot) ?? new Set<string>();
            edges.add(targetFeatureRoot);
            featureEdges.set(importerFeatureRoot, edges);
          }
        }
      }

      const webPackage = webPackageForSpecifier(webPackages, sourceImport.specifier);
      if (!webPackage) continue;
      if (!governedWebPackages.has(webPackage.name)) {
        violations.push({
          policy: "ui-web-package-governance",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Frontend UI may not consume ungoverned web package ${JSON.stringify(webPackage.name)}.`,
          allowed: "Govern the package and pass its public export and closure checks first.",
        });
        continue;
      }
      const capability = capabilityForSpecifier(webPackages, sourceImport.specifier);
      if (!capability) {
        violations.push({
          policy: "ui-web-public-entry",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Feature web package ${webPackage.name} may only be imported through an explicit screens/* or surfaces/* entry.`,
        });
        continue;
      }
      const exports = packageExports(webPackage);
      if (!exports.has(capability.exportPath)) {
        violations.push({
          policy: "ui-web-public-entry",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Import is not an explicit export of ${webPackage.name}.`,
        });
      }
      if (!importerFeature) {
        violations.push({
          policy: "ui-web-capability-owner",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: "Only a named frontend feature may import a feature-web screen or surface.",
        });
        continue;
      }
      const declared = declaredUses(importerFeature);
      if (!declared.has(sourceImport.specifier)) {
        violations.push({
          policy: "ui-web-capability-declaration",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Frontend feature ${JSON.stringify(importerFeature.id)} has not declared this ${capability.kind} capability.`,
          allowed:
            "Add the exact public import to uses.screens or uses.surfaces in apps/ui/src/features/catalogue.json.",
        });
      }
      if (capability.kind === "screen" && capability.id !== importerFeature.id) {
        violations.push({
          policy: "ui-screen-owner",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Screen owner ${JSON.stringify(capability.id)} does not match frontend feature ${JSON.stringify(importerFeature.id)}.`,
          allowed:
            "Screens are owner-only. Import a declared surface for cross-feature presentation.",
        });
      }
      if (
        capability.kind === "screen" &&
        !importerFeature.uses.screens.includes(sourceImport.specifier)
      ) {
        violations.push({
          policy: "ui-screen-declaration",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: "A screen must be declared in uses.screens, not uses.surfaces.",
        });
      }
      if (
        capability.kind === "surface" &&
        !importerFeature.uses.surfaces.includes(sourceImport.specifier)
      ) {
        violations.push({
          policy: "ui-surface-declaration",
          file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: "A surface must be declared in uses.surfaces, not uses.screens.",
        });
      }
    }
  }

  const visit = (start: string, current: string, seen: Set<string>): void => {
    for (const target of featureEdges.get(current) ?? []) {
      if (target === start) {
        violations.push({
          policy: "ui-feature-cycle",
          file: join(featuresRoot, current),
          message: `Frontend feature implementation cycle reaches ${JSON.stringify(start)}.`,
        });
      } else if (!seen.has(target)) {
        seen.add(target);
        visit(start, target, seen);
      }
    }
  };
  for (const feature of featureEdges.keys()) visit(feature, feature, new Set([feature]));
  return violations;
}

function surfaceIdForPath(packageSourceRoot: string, file: string): string | undefined {
  const segments = relative(packageSourceRoot, file).split(sep);
  return segments[0] === "surfaces" ? segments[1] : void 0;
}

function forbiddenSurfaceDirectory(packageSourceRoot: string, file: string): string | undefined {
  const segments = relative(packageSourceRoot, file).split(sep);
  return segments.find((segment) => SURFACE_FORBIDDEN_DIRECTORIES.has(segment));
}

function lintWebScreenClosures(
  root: string,
  webPackages: readonly WebPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of webPackages) {
    const sourceRoot = join(pkg.root, "src");
    for (const [exportPath, target] of packageExports(pkg)) {
      if (isTestOnlyExportTarget(target)) continue;
      const capability = capabilityForSpecifier(webPackages, `${pkg.name}/${exportPath.slice(2)}`);
      if (!capability || capability.kind !== "screen") continue;
      const entry = resolve(pkg.root, target);
      if (!isWithin(sourceRoot, entry) || !existsSync(entry)) {
        violations.push({
          policy: "ui-screen-closure",
          file: pkg.manifestPath,
          specifier: exportPath,
          message: "A screen export must resolve to a local source module.",
        });
        continue;
      }
      const pending = [entry];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const currentSource = readFileSync(current, "utf8");
        for (const browserCapability of browserCapabilitySourceViolations(currentSource)) {
          violations.push({
            policy: "ui-screen-closure",
            file: current,
            specifier: exportPath,
            message: `An owner-only screen may not use ${browserCapability} directly.`,
            allowed: "Receive browser data and actions from its owning frontend feature.",
          });
        }
        for (const sourceImport of importsIn(current)) {
          if (sourceImport.nonLiteral) {
            violations.push({
              policy: "ui-screen-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: "An owner-only screen may not load a non-literal module specifier.",
            });
            continue;
          }
          const forbiddenImport =
            forbiddenWebPresentationImport(sourceImport.specifier) ??
            (isLegacyApplicationRelativeImport(root, current, sourceImport.specifier)
              ? "legacy platform/app implementation"
              : void 0);
          if (forbiddenImport) {
            violations.push({
              policy: "ui-screen-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: `An owner-only screen may not import ${forbiddenImport}.`,
            });
          }
          const targetFile = resolveRelativeSource(sourceImport);
          if (!targetFile) continue;
          if (!isWithin(sourceRoot, targetFile)) {
            violations.push({
              policy: "ui-screen-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: "An owner-only screen may not reach source outside its web package.",
              allowed: "Import portable contracts through their public workspace package.",
            });
            continue;
          }
          pending.push(targetFile);
        }
      }
    }
  }
  return violations;
}

function forbiddenSurfaceImport(specifier: string): string | undefined {
  return forbiddenWebPresentationImport(specifier);
}

function lintWebSurfaceClosures(
  root: string,
  webPackages: readonly WebPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of webPackages) {
    const exports = packageExports(pkg);
    const sourceRoot = join(pkg.root, "src");
    for (const [exportPath, target] of exports) {
      if (isTestOnlyExportTarget(target)) continue;
      const capability = capabilityForSpecifier(webPackages, `${pkg.name}/${exportPath.slice(2)}`);
      if (!capability || capability.kind !== "surface") continue;
      const entry = resolve(pkg.root, target);
      if (!isWithin(sourceRoot, entry) || !existsSync(entry)) {
        violations.push({
          policy: "ui-surface-closure",
          file: pkg.manifestPath,
          specifier: exportPath,
          message: "A surface export must resolve to a local source module.",
        });
        continue;
      }
      const surfaceRoot = join(sourceRoot, "surfaces", capability.id);
      const pending = [{ file: entry, chain: [entry] }];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const currentNode = pending.pop()!;
        const { file: current, chain } = currentNode;
        if (visited.has(current)) continue;
        visited.add(current);
        const currentSource = readFileSync(current, "utf8");
        for (const capability of browserCapabilitySourceViolations(currentSource)) {
          violations.push({
            policy: "ui-surface-closure",
            file: current,
            specifier: exportPath,
            message: `A shareable surface may not use ${capability} directly.`,
            allowed: "Receive portable values and controlled actions from the consuming feature.",
          });
        }
        const forbidden = forbiddenSurfaceDirectory(sourceRoot, current);
        const surfaceId = surfaceIdForPath(sourceRoot, current);
        const escapedSurface = !isWithin(surfaceRoot, current);
        if (forbidden || escapedSurface || (surfaceId !== void 0 && surfaceId !== capability.id)) {
          const dependencyPath = chain
            .map((path) => relative(sourceRoot, path).split(sep).join("/"))
            .join(" -> ");
          violations.push({
            policy: "ui-surface-closure",
            file: current,
            specifier: exportPath,
            message: forbidden
              ? `Surface ${JSON.stringify(capability.id)} reaches forbidden local ${JSON.stringify(forbidden)} implementation via ${dependencyPath}.`
              : escapedSurface
                ? `Surface ${JSON.stringify(capability.id)} escapes its own directory via ${dependencyPath}.`
                : `Surface ${JSON.stringify(capability.id)} reaches another surface ${JSON.stringify(surfaceId)} via ${dependencyPath}.`,
            allowed:
              "A shareable surface may depend only on its own implementation and portable presentation collaborators.",
          });
          continue;
        }
        for (const sourceImport of importsIn(current)) {
          if (sourceImport.nonLiteral) {
            violations.push({
              policy: "ui-surface-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: "A shareable surface may not load a non-literal module specifier.",
            });
            continue;
          }
          const forbiddenImport =
            forbiddenSurfaceImport(sourceImport.specifier) ??
            (isLegacyApplicationRelativeImport(root, current, sourceImport.specifier)
              ? "legacy platform/app implementation"
              : void 0);
          if (forbiddenImport) {
            violations.push({
              policy: "ui-surface-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: `A shareable surface may not import ${forbiddenImport}.`,
            });
          }
          const targetFile = resolveRelativeSource(sourceImport);
          if (!targetFile) continue;
          if (!isWithin(sourceRoot, targetFile)) {
            violations.push({
              policy: "ui-surface-closure",
              file: current,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: "A shareable surface may not reach source outside its web package.",
              allowed: "Import portable contracts through their public workspace package.",
            });
            continue;
          }
          pending.push({ file: targetFile, chain: [...chain, targetFile] });
        }
      }
    }
  }
  return violations;
}

export function lintFrontendUiBoundaries(
  root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const { catalogue, violations } = readUiFeatureCatalogue(root);
  if (!catalogue) return violations;
  const webPackages = packages.filter(
    (pkg): pkg is WebPackage => pkg.kind === "web" && pkg.feature !== void 0,
  );
  const selectedPackageNames = new Set(catalogue.governedWebPackages);
  const selectedWebPackages = webPackages.filter((pkg) => selectedPackageNames.has(pkg.name));
  return [
    ...violations,
    ...lintUiRootDirectories(root),
    ...lintUiFeatureRoots(root, catalogue),
    ...lintGovernedWebPackages(root, catalogue, webPackages),
    ...lintDeclaredCapabilities(root, catalogue, webPackages),
    ...lintWebPublicExports(selectedWebPackages),
    ...lintUiSourceBoundaries(root, catalogue, webPackages),
    ...lintWebScreenClosures(root, selectedWebPackages),
    ...lintWebSurfaceClosures(root, selectedWebPackages),
  ];
}
