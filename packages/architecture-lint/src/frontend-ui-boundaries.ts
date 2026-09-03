import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { browserOnlyPackage } from "./browser-packages";
import { walkFiles } from "./files";
import {
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  resolveRelativeModule,
  resolveSourceCandidate,
  walkValueImportGraph,
  type ModuleImport,
  type WorkspaceModuleResolver,
} from "./module-graph";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const UI_FEATURE_CATALOGUE_PATH = join("apps", "ui", "src", "features", "catalogue.json");
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier.replace(/^node:/, "")}`]),
);
const UI_SOURCE_DIRECTORIES = new Set([
  "behavior",
  "features",
  "model",
  "screens",
  "surfaces",
  "ui",
]);
const UI_GLOBAL_DIRECTORIES = new Set(["behavior", "model", "ui"]);
const UI_COMPOSITION_DIRECTORIES = new Set(["screens", "surfaces"]);
const SURFACE_FORBIDDEN_DIRECTORIES = new Set([
  "internal",
  "queries",
  "routes",
  "screens",
  "state",
  "stores",
  "transport",
]);
const WEB_FEATURE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const WEB_UI_LAYERS = new Set(["elements", "blocks", "sections"]);
const UI_LAYER_DEPENDENCIES: Record<string, readonly string[]> = {
  model: ["model"],
  behavior: ["model", "behavior"],
  elements: ["model", "elements"],
  blocks: ["model", "elements", "blocks"],
  sections: ["model", "behavior", "elements", "blocks", "sections"],
};

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

const webFeatureDeclarationSchema = z
  .object({
    version: z.literal(0),
    dependencies: z.array(z.string().regex(WEB_FEATURE_NAME)),
  })
  .strict();

type UiFeatureCatalogue = z.infer<typeof uiFeatureCatalogueSchema>;
type UiFeature = UiFeatureCatalogue["features"][number];
type WebFeatureDeclaration = z.infer<typeof webFeatureDeclarationSchema>;

type SourceImport = ModuleImport;

type Capability = {
  packageName: string;
  exportPath: string;
  kind: "screen" | "surface";
  id: string;
};

type WebPackage = ClassifiedPackage & { kind: "web"; feature: string };

/**
 * Screens are allowed the typed client and React Query (lane T puts
 * `trpcReact` from `@langwatch/platform-api-client` in every web package);
 * they still may not reach for `@trpc/client` or `@trpc/react-query/*` raw.
 */
function isScreenPortableTransport(specifier: string): boolean {
  return (
    /^@tanstack\/react-query(?:\/|$)/.test(specifier) ||
    /^@langwatch\/platform-api-client(?:\/|$)/.test(specifier)
  );
}

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
  // Not `a.fetch(...)`: a tRPC utils client, a repository port and a queue
  // client all name a method `fetch`, and calling one is not reaching for the
  // browser global. The lookbehind is what tells the two apart.
  [/(?<![.\w$])fetch\s*\(/, "fetch"],
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

function resolveUiSourceImport(sourceImport: SourceImport, sourceRoot: string): string | undefined {
  const relativeTarget = resolveRelativeModule({
    file: sourceImport.file,
    specifier: sourceImport.specifier,
  });
  if (relativeTarget) return relativeTarget;
  if (!/^(?:~|@)\//.test(sourceImport.specifier)) return void 0;
  return resolveSourceCandidate({
    candidate: resolve(sourceRoot, sourceImport.specifier.slice(2)),
  });
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

type UiFeatureModule =
  | { kind: "entry"; feature: string }
  | {
      kind: "implementation";
      feature: string;
      layer: "model" | "behavior" | "ui";
      uiLayer?: string;
    };

function uiFeatureModuleForFile(uiFeaturesRoot: string, file: string): UiFeatureModule | undefined {
  const feature = featureForFile(uiFeaturesRoot, file);
  if (!feature) return void 0;

  const featureRoot = join(uiFeaturesRoot, feature);
  const segments = relative(featureRoot, file).split(sep);
  const [first, second] = segments;
  if (segments.length === 1 && first === "index.ts") {
    return { kind: "entry", feature };
  }
  if (first === "model" || first === "behavior") {
    return { kind: "implementation", feature, layer: first };
  }
  if (first === "ui" && second !== void 0 && WEB_UI_LAYERS.has(second)) {
    return { kind: "implementation", feature, layer: "ui", uiLayer: second };
  }
  return void 0;
}

function uiFeatureLayer(module: Extract<UiFeatureModule, { kind: "implementation" }>): string {
  return module.layer === "ui" ? module.uiLayer! : module.layer;
}

function canUiLayerDependOn(sourceLayer: string, targetLayer: string): boolean {
  return UI_LAYER_DEPENDENCIES[sourceLayer]?.includes(targetLayer) ?? false;
}

function canUiFeatureDependOn(source: UiFeatureModule, target: UiFeatureModule): boolean {
  if (source.kind === "entry") return target.kind === "implementation";
  if (target.kind === "entry") return false;

  return canUiLayerDependOn(uiFeatureLayer(source), uiFeatureLayer(target));
}

function uiGlobalLayerForFile(sourceRoot: string, file: string): string | undefined {
  const [first, second] = relative(sourceRoot, file).split(sep);
  if (first === "model" || first === "behavior") return first;
  if (first === "ui" && second !== void 0 && WEB_UI_LAYERS.has(second)) return second;
  return void 0;
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

const commentFreeSources = new Map<string, string>();

/**
 * The source with its comments blanked out, positions intact.
 *
 * The capability checks below are regex searches over the raw file, so a
 * docblock that NAMES a capability in order to explain why the module avoids
 * it was reported as a use of it. `apps/ui/src/behavior/public-config.ts` is
 * the case that found this: its header explains that the browser has no
 * `process.env`, and saying so was the violation.
 *
 * The PARSER decides what a comment is, not a bare scanner. A template literal
 * with a substitution needs `rescanTemplateToken` to be continued correctly,
 * and a plain `scan()` loop does not call it: the backtick pairing falls out of
 * phase at the first `${...}` and stays there, so every backtick after it —
 * including the ones docblocks put around inline code — flips a span the
 * scanner then reports as template text rather than as the comment it is.
 * `packages/redaction/src/secrets.ts` is the case that found this. Its
 * docblock quotes `process.env.OPENAI_API_KEY` to say the matcher treats that
 * as code rather than as key material, the quote was read as a use of it, and
 * the package stopped counting as portable. Everything after the first such
 * template leaked, which is why this could not be fixed by excusing one
 * pattern.
 *
 * Walking the parsed tree costs one parse per distinct source and is exact,
 * which is why the answer is memoised by source text rather than recomputed
 * for each of the closure walks that ask.
 *
 * Comments are replaced by spaces rather than removed, so every offset a
 * later check reports still lines up with the file on disk. Newlines survive
 * for the same reason.
 */
function withoutComments(source: string): string {
  const known = commentFreeSources.get(source);
  if (known !== void 0) return known;

  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const characters = source.split("");
  const blank = (range: ts.CommentRange): void => {
    for (let index = range.pos; index < range.end; index += 1) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  };
  // Tokens rather than nodes: `forEachChild` skips punctuation, and a JSX
  // comment lives in the trivia before the closing brace of `{/* ... */}`.
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);

    if (children.length === 0) {
      for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) blank(range);

      return;
    }

    for (const child of children) visit(child);
  };

  visit(sourceFile);

  const blanked = characters.join("");
  commentFreeSources.set(source, blanked);

  return blanked;
}

function browserCapabilitySourceViolations(source: string): string[] {
  const code = withoutComments(source);

  return BROWSER_CAPABILITY_SOURCE.filter(([pattern]) => pattern.test(code)).map(
    ([, description]) => description,
  );
}

/**
 * The two roles that are portable because of what they ARE, whatever they
 * import.
 *
 * The Design System is React by construction — it is the one presentation
 * dependency browser UI is meant to share — so no framework check can admit
 * it. A feature contract is the declared shape of a feature's data, and ADR-004
 * names it portable in that role.
 *
 * Everything else first-party has to prove it.
 *
 * `ui-drawer` and `ui-host` join the Design System here for the same reason:
 * both are UI platform packages, not features, and neither can prove
 * portable by scanning its imports (they are React by construction).
 */
const PORTABLE_BY_ROLE =
  /^@langwatch\/(?:design-system(?:\/|$)|ui-drawer(?:\/|$)|ui-host(?:\/|$)|[^/]+-contract(?:\/|$))/;

export type PortableModuleOracle = {
  /** Whether a first-party specifier resolves to a provably portable module. */
  isPortable: (specifier: string) => boolean;
};

/**
 * Whether a first-party module is portable into browser UI, decided by reading
 * it rather than by reading its package name.
 *
 * The name test this replaces admitted the Design System and `*-contract` and
 * refused every other `@langwatch/*` specifier as "a first-party implementation
 * package". That verdict was wrong for the framework-free platform modules the
 * browser genuinely shares: `@langwatch/config/docs-url` is a URL builder over
 * a type-only import, and `@langwatch/handled-error`'s subpaths are the error
 * codes, the customer-facing presentation table and the reader that turns a
 * wire payload into them. Refusing those pushed every web package toward a
 * private copy of the codes — which is the drift the presentation registry
 * exists to prevent.
 *
 * Portable means the module's whole VALUE closure stays clear of React and the
 * other browser-only toolkits, of the transport, router, session and storage
 * capabilities a screen must receive rather than reach for, of server, Prisma
 * and environment implementation, and of Node builtins. `import type` is
 * erased, so a portable module may still name any type it likes. A module that
 * renders JSX is framework-bound whether or not it names React, so the walk
 * counts the compiler-emitted `react/jsx-runtime` edge too.
 *
 * A specifier that resolves to no workspace package is left to the caller's own
 * rule: this oracle answers about code it can read, and an unresolvable
 * `@langwatch/*` specifier is either a package outside the workspace or a
 * subpath its manifest does not export.
 */
function createPortableModuleOracle({ root }: { root: string }): PortableModuleOracle {
  let resolver: WorkspaceModuleResolver | undefined;
  const answers = new Map<string, boolean>();

  const nonPortableEdge = (specifier: string): string | undefined => {
    if (NODE_BUILTIN_SPECIFIERS.has(specifier)) return "a Node.js builtin";

    return (
      browserOnlyPackage(specifier) ??
      forbiddenBrowserCapabilityImport(specifier) ??
      isForbiddenUiSpecifier(specifier)
    );
  };

  const isPortable = (specifier: string): boolean => {
    const known = answers.get(specifier);

    if (known !== void 0) return known;

    const workspace = (resolver ??= createWorkspaceModuleResolver({ root }));
    const packageName = specifier
      .split("/")
      .slice(0, specifier.startsWith("@") ? 2 : 1)
      .join("/");
    const entry = workspace.packages.has(packageName)
      ? workspace.resolve({ specifier, file: join(root, "package.json") })
      : void 0;
    const portable =
      entry !== void 0 &&
      walkValueImportGraph({
        roots: [entry],
        resolve: (options) => workspace.resolve(options),
        forbidden: ({ specifier: edge }) => nonPortableEdge(edge),
        emitted: ({ file }) =>
          rendersJsx({ file })
            ? "react/jsx-runtime"
            : browserCapabilitySourceViolations(readFileSync(file, "utf8"))[0],
      }).seeds.size === 0;

    answers.set(specifier, portable);

    return portable;
  };

  return { isPortable };
}

/**
 * Whether browser UI may import a first-party specifier: because of the role
 * the package plays, or because the module proved it.
 */
function isPortableFirstPartyImport({
  specifier,
  portable,
}: {
  specifier: string;
  portable: PortableModuleOracle;
}): boolean {
  return PORTABLE_BY_ROLE.test(specifier) || portable.isPortable(specifier);
}

function forbiddenWebPresentationImport({
  specifier,
  portable,
}: {
  specifier: string;
  portable: PortableModuleOracle;
}): string | undefined {
  if (isScreenPortableTransport(specifier)) return void 0;
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
  if (specifier.startsWith("@langwatch/") && !isPortableFirstPartyImport({ specifier, portable })) {
    return "a first-party implementation package instead of a portable module, a contract, or the Design System";
  }
  return void 0;
}

function forbiddenFrontendFeatureImport({
  specifier,
  portable,
}: {
  specifier: string;
  portable: PortableModuleOracle;
}): string | undefined {
  const forbiddenCapability = forbiddenBrowserCapabilityImport(specifier);
  if (forbiddenCapability) return forbiddenCapability;
  const declaredWebCapability = /^@langwatch\/[^/]+-web(?:\/|$)/.test(specifier);

  if (
    specifier.startsWith("@langwatch/") &&
    !declaredWebCapability &&
    !isPortableFirstPartyImport({ specifier, portable })
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
    const isPackageEntry =
      segments.length === 1 && (segments[0] === "index.ts" || segments[0] === "ui.entrypoint.tsx");
    if (isPackageEntry || (segments.length > 1 && UI_SOURCE_DIRECTORIES.has(segments[0]!))) {
      return [];
    }
    return [
      {
        policy: "ui-root-catch-all",
        file,
        message: `apps/ui production source must live in global model, behavior, ui, screens, surfaces, or a private feature; ${JSON.stringify(segments[0])} has no architectural owner.`,
        allowed:
          "Keep only the package entry at src/index.ts; place implementation in a governed global or named feature root.",
      },
    ];
  });
}

function lintUiGlobalStructure(root: string): ArchitectureViolation[] {
  const sourceRoot = join(root, "apps", "ui", "src");
  const uiRoot = join(sourceRoot, "ui");
  if (!existsSync(uiRoot)) return [];

  return sourceFiles(uiRoot).flatMap((file) => {
    const [rootDirectory = "", layer = ""] = relative(sourceRoot, file).split(sep);
    if (rootDirectory === "ui" && WEB_UI_LAYERS.has(layer)) return [];

    return [
      {
        policy: "ui-global-layout",
        file,
        message:
          "Global apps/ui presentation must live under ui/{elements,blocks,sections}; unlayered ui files have no architectural owner.",
        allowed: "Place global presentation in ui/elements, ui/blocks, or ui/sections.",
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

function lintUiFeatureStructure(root: string): ArchitectureViolation[] {
  const sourceRoot = join(root, "apps", "ui", "src");
  const featuresRoot = join(sourceRoot, "features");
  const violations: ArchitectureViolation[] = [];

  for (const file of sourceFiles(featuresRoot)) {
    const feature = featureForFile(featuresRoot, file);
    if (!feature) continue;

    const module = uiFeatureModuleForFile(featuresRoot, file);
    if (!module) {
      violations.push({
        policy: "ui-feature-layout",
        file,
        message:
          "Private apps/ui feature code must live in model, behavior, or ui/{elements,blocks,sections}; only features/<feature>/index.ts may live at the feature root.",
      });
      continue;
    }
    if (module.kind === "entry") continue;

    for (const sourceImport of moduleImports({ file: file })) {
      if (sourceImport.nonLiteral) continue;
      const target = resolveUiSourceImport(sourceImport, sourceRoot);
      if (!target || !isWithin(featuresRoot, target)) continue;

      const targetFeature = featureForFile(featuresRoot, target);
      if (targetFeature !== feature) continue;
      const targetModule = uiFeatureModuleForFile(featuresRoot, target);
      if (!targetModule || canUiFeatureDependOn(module, targetModule)) continue;

      violations.push({
        policy: "ui-feature-dependency-direction",
        file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: `Feature ${JSON.stringify(feature)} ${uiFeatureLayer(module)} code may not depend on ${targetModule.kind === "entry" ? "its feature entry" : `${uiFeatureLayer(targetModule)} code`}.`,
        allowed: "Keep dependencies flowing from model to behavior to the allowed UI layers.",
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
  portable: PortableModuleOracle,
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

    const code = withoutComments(source);
    if (/\bAppRouter\b/.test(code)) {
      violations.push({
        policy: "ui-backend-access",
        file,
        message:
          "Browser UI may not reference AppRouter; define portable transport contracts instead.",
      });
    }
    if (/\bprocess\.env\b/.test(code)) {
      violations.push({
        policy: "ui-backend-access",
        file,
        message:
          "Browser UI may not read process.env; receive validated public configuration through platform composition.",
      });
    }

    for (const sourceImport of moduleImports({ file: file })) {
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
          ? forbiddenFrontendFeatureImport({ specifier: sourceImport.specifier, portable })
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
        const [importerArea = ""] = relative(sourceRoot, file).split(sep);
        const [targetArea = ""] = relative(sourceRoot, target).split(sep);
        const importerGlobalLayer = uiGlobalLayerForFile(sourceRoot, file);
        const targetGlobalLayer = uiGlobalLayerForFile(sourceRoot, target);
        const globalLayerImportsPrivateFeature =
          UI_GLOBAL_DIRECTORIES.has(importerArea) && targetArea === "features";
        const globalLayerImportsCompositionBoundary =
          UI_GLOBAL_DIRECTORIES.has(importerArea) && UI_COMPOSITION_DIRECTORIES.has(targetArea);
        const privateFeatureImportsCompositionBoundary =
          importerArea === "features" && UI_COMPOSITION_DIRECTORIES.has(targetArea);
        if (globalLayerImportsPrivateFeature || globalLayerImportsCompositionBoundary) {
          violations.push({
            policy: "ui-dependency-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "Global UI layers may not import private frontend features or composition boundaries.",
          });
        }
        if (privateFeatureImportsCompositionBoundary) {
          violations.push({
            policy: "ui-dependency-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: "A private frontend feature may not import a composition boundary.",
          });
        }
        if (
          importerGlobalLayer !== void 0 &&
          targetGlobalLayer !== void 0 &&
          !canUiLayerDependOn(importerGlobalLayer, targetGlobalLayer)
        ) {
          violations.push({
            policy: "ui-dependency-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: `Global UI ${importerGlobalLayer} code may not depend on ${targetGlobalLayer} code.`,
            allowed: "Keep dependencies flowing from model to behavior to the allowed UI layers.",
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
  portable: PortableModuleOracle,
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
        for (const sourceImport of moduleImports({ file: current })) {
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
            forbiddenWebPresentationImport({ specifier: sourceImport.specifier, portable }) ??
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
          const targetFile = resolveRelativeModule({
            file: sourceImport.file,
            specifier: sourceImport.specifier,
          });
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

function lintWebSurfaceClosures(
  root: string,
  webPackages: readonly WebPackage[],
  portable: PortableModuleOracle,
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
      const globalModelRoot = join(sourceRoot, "model");
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
        const escapedSurface =
          !isWithin(surfaceRoot, current) && !isWithin(globalModelRoot, current);
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
        for (const sourceImport of moduleImports({ file: current })) {
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
            forbiddenWebPresentationImport({ specifier: sourceImport.specifier, portable }) ??
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
          const targetFile = resolveRelativeModule({
            file: sourceImport.file,
            specifier: sourceImport.specifier,
          });
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

type WebPrivateModule =
  | { kind: "global"; layer: "model" | "behavior" | "ui"; uiLayer?: string }
  | {
      kind: "feature";
      feature: string;
      layer: "model" | "behavior" | "ui";
      uiLayer?: string;
    }
  | { kind: "feature-entry"; feature: string }
  | { kind: "package-entry" }
  | { kind: "screen" }
  | { kind: "surface" };

function webPrivateModuleForFile(sourceRoot: string, file: string): WebPrivateModule | undefined {
  const segments = relative(sourceRoot, file).split(sep);
  const [first, second, third, fourth] = segments;
  if (segments.length === 1 && isWebRootException(file)) return { kind: "package-entry" };
  if (first === "screens") return { kind: "screen" };
  if (first === "surfaces") return { kind: "surface" };
  if (first === "features" && second && WEB_FEATURE_NAME.test(second)) {
    if (third === "index.ts") return { kind: "feature-entry", feature: second };
    if (
      (third === "model" || third === "behavior" || third === "ui") &&
      (third !== "ui" || (fourth !== void 0 && WEB_UI_LAYERS.has(fourth)))
    ) {
      return {
        kind: "feature",
        feature: second,
        layer: third,
        uiLayer: third === "ui" ? fourth : void 0,
      };
    }
    return void 0;
  }
  if (
    (first === "model" || first === "behavior" || first === "ui") &&
    (first !== "ui" || (second !== void 0 && WEB_UI_LAYERS.has(second)))
  ) {
    return {
      kind: "global",
      layer: first,
      uiLayer: first === "ui" ? second : void 0,
    };
  }
  return void 0;
}

function isWebRootException(file: string): boolean {
  const name = relative(dirname(file), file);
  return (
    /^(?:index|testing)\.[cm]?[jt]sx?$/.test(name) ||
    /^[a-z0-9-]+\.config\.[cm]?[jt]sx?$/.test(name)
  );
}

function readWebFeatureDeclarations(sourceRoot: string): {
  declarations: Map<string, WebFeatureDeclaration>;
  violations: ArchitectureViolation[];
} {
  const featuresRoot = join(sourceRoot, "features");
  const declarations = new Map<string, WebFeatureDeclaration>();
  const violations: ArchitectureViolation[] = [];
  if (!existsSync(featuresRoot)) return { declarations, violations };

  for (const entry of readdirSync(featuresRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const featureRoot = join(featuresRoot, entry.name);
    const declarationPath = join(featureRoot, "feature.json");
    if (!WEB_FEATURE_NAME.test(entry.name)) {
      violations.push({
        policy: "ui-web-feature-layout",
        file: featureRoot,
        message: `Web feature directories must use lower-kebab-case names; ${JSON.stringify(entry.name)} does not.`,
      });
      continue;
    }
    if (!existsSync(declarationPath)) {
      violations.push({
        policy: "ui-web-feature-declaration",
        file: featureRoot,
        message: `Web feature ${JSON.stringify(entry.name)} must declare its direct feature dependencies in feature.json.`,
        allowed:
          "Add { version: 0, dependencies: [] } before importing another private web feature.",
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(declarationPath, "utf8"));
    } catch (error) {
      violations.push({
        policy: "ui-web-feature-declaration",
        file: declarationPath,
        message: `Web feature declaration must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const result = webFeatureDeclarationSchema.safeParse(parsed);
    if (!result.success) {
      violations.push({
        policy: "ui-web-feature-declaration",
        file: declarationPath,
        message: `Web feature declaration must match version 0: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      });
      continue;
    }
    if (new Set(result.data.dependencies).size !== result.data.dependencies.length) {
      violations.push({
        policy: "ui-web-feature-declaration",
        file: declarationPath,
        message: "Web feature dependencies must not repeat a feature name.",
      });
    }
    if (result.data.dependencies.includes(entry.name)) {
      violations.push({
        policy: "ui-web-feature-declaration",
        file: declarationPath,
        message: `Web feature ${JSON.stringify(entry.name)} may not depend on itself.`,
      });
    }
    declarations.set(entry.name, result.data);
  }
  for (const [feature, declaration] of declarations) {
    for (const dependency of declaration.dependencies) {
      if (!declarations.has(dependency)) {
        violations.push({
          policy: "ui-web-feature-declaration",
          file: join(featuresRoot, feature, "feature.json"),
          message: `Web feature ${JSON.stringify(feature)} declares missing feature dependency ${JSON.stringify(dependency)}.`,
        });
      }
    }
  }
  return { declarations, violations };
}

function canPrivateLayerDependOn(
  source: Extract<WebPrivateModule, { kind: "global" | "feature" }>,
  target: Extract<WebPrivateModule, { kind: "global" | "feature" }>,
): boolean {
  const sourceLayer = source.layer === "ui" ? source.uiLayer : source.layer;
  const targetLayer = target.layer === "ui" ? target.uiLayer : target.layer;
  const allowed: Record<string, readonly string[]> = {
    model: ["model"],
    behavior: ["model", "behavior"],
    elements: ["model", "elements"],
    blocks: ["model", "elements", "blocks"],
    sections: ["model", "behavior", "elements", "blocks", "sections"],
  };
  return Boolean(
    sourceLayer !== void 0 && targetLayer !== void 0 && allowed[sourceLayer]?.includes(targetLayer),
  );
}

function lintWebPrivateStructure(webPackages: readonly WebPackage[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of webPackages) {
    const sourceRoot = join(pkg.root, "src");
    if (!existsSync(sourceRoot)) continue;
    const { declarations, violations: declarationViolations } =
      readWebFeatureDeclarations(sourceRoot);
    violations.push(...declarationViolations);
    const featureEdges = new Map<string, Set<string>>();
    for (const [feature, declaration] of declarations) {
      featureEdges.set(
        feature,
        new Set(declaration.dependencies.filter((dependency) => dependency !== feature)),
      );
    }

    for (const file of sourceFiles(sourceRoot)) {
      const segments = relative(sourceRoot, file).split(sep);
      const module = webPrivateModuleForFile(sourceRoot, file);
      if (segments.length === 1 && !isWebRootException(file)) {
        violations.push({
          policy: "ui-web-root-flat",
          file,
          message: "Feature-web production source may not live flat at src/.",
          allowed:
            "Use package-global model, behavior, or ui; a named private feature; or a public screen or surface boundary.",
        });
      }
      if (segments[0] === "components") {
        violations.push({
          policy: "ui-web-root-components",
          file,
          message: "Feature-web packages may not use a generic src/components catch-all.",
          allowed: "Put UI in package-global ui or in the owning named private feature.",
        });
      }
      if (!module) {
        violations.push({
          policy: "ui-web-private-layout",
          file,
          message:
            "Private feature-web code must live in model, behavior, ui/{elements,blocks,sections}, or features/<feature>/{model,behavior,ui}.",
        });
        continue;
      }
      if (module.kind === "package-entry") continue;

      for (const sourceImport of moduleImports({ file: file })) {
        if (sourceImport.nonLiteral) continue;
        const targetFile = resolveUiSourceImport(sourceImport, sourceRoot);
        if (!targetFile || !isWithin(sourceRoot, targetFile)) continue;
        const target = webPrivateModuleForFile(sourceRoot, targetFile);
        if (!target) {
          violations.push({
            policy: "ui-web-private-layout",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "Feature-web code may not import a local module outside the governed private layout.",
          });
          continue;
        }
        if (
          (module.kind === "global" ||
            module.kind === "feature" ||
            module.kind === "feature-entry") &&
          (target.kind === "screen" || target.kind === "surface")
        ) {
          violations.push({
            policy: "ui-web-public-boundary-leakage",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "Private feature-web implementation may not depend inward on a public screen or surface boundary.",
          });
          continue;
        }
        if (
          module.kind === "surface" &&
          target.kind !== "surface" &&
          !(target.kind === "global" && target.layer === "model")
        ) {
          violations.push({
            policy: "ui-web-surface-leakage",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "A public surface may not reach package-private features, global layers, or a screen.",
          });
          continue;
        }
        if (module.kind === "screen" && target.kind === "screen") {
          const sourceScreen = relative(sourceRoot, file).split(sep)[1];
          const targetScreen = relative(sourceRoot, targetFile).split(sep)[1];
          if (sourceScreen !== targetScreen) {
            violations.push({
              policy: "ui-web-screen-leakage",
              file,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: "A screen may not compose another owner-only screen.",
              allowed: "Extract a narrow surface or compose named private feature sections.",
            });
            continue;
          }
        }
        if (
          module.kind === "global" &&
          (target.kind === "feature" || target.kind === "feature-entry")
        ) {
          violations.push({
            policy: "ui-web-global-feature-leakage",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "Package-global model, behavior, and ui may not depend on a private feature implementation.",
          });
          continue;
        }
        if (
          module.kind === "feature-entry" &&
          ((target.kind === "feature" && target.feature !== module.feature) ||
            (target.kind === "feature-entry" && target.feature !== module.feature))
        ) {
          violations.push({
            policy: "ui-web-feature-entry-leakage",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: `Web feature entry ${JSON.stringify(module.feature)} may not compose another private feature.`,
            allowed:
              "Keep the entry to its own feature API; compose another feature only from a ui/sections module with a declared dependency.",
          });
          continue;
        }
        if (module.kind === "feature" && target.kind === "feature-entry") {
          if (module.feature === target.feature) continue;
          if (module.layer !== "ui" || module.uiLayer !== "sections") {
            violations.push({
              policy: "ui-web-feature-layer-dependency",
              file,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message:
                "Only a feature ui/sections module may compose another private feature's public entry.",
              allowed: "Promote lower-level reuse to package-global model, behavior, or ui.",
            });
          }
          const declaration = declarations.get(module.feature);
          if (!declaration?.dependencies.includes(target.feature)) {
            violations.push({
              policy: "ui-web-feature-dependency-declaration",
              file,
              line: sourceImport.line,
              specifier: sourceImport.specifier,
              message: `Web feature ${JSON.stringify(module.feature)} must declare ${JSON.stringify(target.feature)} before using its public entry.`,
              allowed: `Add ${JSON.stringify(target.feature)} to features/${module.feature}/feature.json dependencies.`,
            });
          }
          const edges = featureEdges.get(module.feature) ?? new Set<string>();
          edges.add(target.feature);
          featureEdges.set(module.feature, edges);
          continue;
        }
        if (
          module.kind === "feature" &&
          target.kind === "feature" &&
          module.feature !== target.feature
        ) {
          violations.push({
            policy: "ui-web-feature-deep-import",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message: `Web feature ${JSON.stringify(module.feature)} may only import the public entry of ${JSON.stringify(target.feature)}.`,
            allowed: `Import features/${target.feature}/index.ts and declare the dependency.`,
          });
          const edges = featureEdges.get(module.feature) ?? new Set<string>();
          edges.add(target.feature);
          featureEdges.set(module.feature, edges);
          continue;
        }
        if (
          (module.kind === "global" || module.kind === "feature") &&
          (target.kind === "global" || target.kind === "feature") &&
          !(
            module.kind === "feature" &&
            target.kind === "feature" &&
            module.feature !== target.feature
          ) &&
          !canPrivateLayerDependOn(module, target)
        ) {
          violations.push({
            policy: "ui-web-layer-direction",
            file,
            line: sourceImport.line,
            specifier: sourceImport.specifier,
            message:
              "Feature-web private layers may not depend upward on a composing UI or behavior layer.",
            allowed:
              "model is independent; behavior uses model; elements use model; blocks compose elements; sections compose blocks, elements, and behavior.",
          });
        }
      }
    }

    let nextIndex = 0;
    const indices = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visit = (feature: string): void => {
      indices.set(feature, nextIndex);
      lowLinks.set(feature, nextIndex);
      nextIndex += 1;
      stack.push(feature);
      onStack.add(feature);

      for (const dependency of [...(featureEdges.get(feature) ?? [])].sort()) {
        if (!indices.has(dependency)) {
          visit(dependency);
          lowLinks.set(feature, Math.min(lowLinks.get(feature)!, lowLinks.get(dependency)!));
        } else if (onStack.has(dependency)) {
          lowLinks.set(feature, Math.min(lowLinks.get(feature)!, indices.get(dependency)!));
        }
      }

      if (lowLinks.get(feature) !== indices.get(feature)) return;
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === void 0) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== feature);
      if (component.length < 2) return;
      const cycle = component.sort();
      violations.push({
        policy: "ui-web-feature-cycle",
        file: join(sourceRoot, "features", cycle[0]!, "feature.json"),
        message: `Private web feature dependency cycle includes ${cycle.map((name) => JSON.stringify(name)).join(", ")}.`,
        allowed: "Invert the dependency or extract a real package-global collaborator.",
      });
    };
    for (const feature of [...featureEdges.keys()].sort()) {
      if (!indices.has(feature)) visit(feature);
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
  const portable = createPortableModuleOracle({ root });
  return [
    ...violations,
    ...lintUiRootDirectories(root),
    ...lintUiGlobalStructure(root),
    ...lintUiFeatureRoots(root, catalogue),
    ...lintUiFeatureStructure(root),
    ...lintGovernedWebPackages(root, catalogue, webPackages),
    ...lintDeclaredCapabilities(root, catalogue, webPackages),
    ...lintWebPublicExports(selectedWebPackages),
    ...lintWebPrivateStructure(selectedWebPackages),
    ...lintUiSourceBoundaries(root, catalogue, webPackages, portable),
    ...lintWebScreenClosures(root, selectedWebPackages, portable),
    ...lintWebSurfaceClosures(root, selectedWebPackages, portable),
  ];
}
