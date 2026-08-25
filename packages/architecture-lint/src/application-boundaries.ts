import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { walkFiles } from "./files";
import { exportedSubpaths } from "./manifests";
import type {
  ArchitectureViolation,
  ClassifiedPackage,
  EnterpriseCompositionRole,
} from "./types";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const LEGACY_BASELINE_PATH = join(
  "packages",
  "architecture-lint",
  "src",
  "legacy-application-boundary-baseline.json",
);
const API_RUNTIME = "@langwatch/platform-api/runtime";
const WORKER_RUNTIME = "@langwatch/worker/runtime";

const PRODUCT_IMPLEMENTATION_PATH =
  /(?:^|\/)(?:services?|repositories?|routes?|consumers?|jobs?)(?:\/|\.|$)/i;

const ENTERPRISE_ROOT_RUNTIME_IMPORT = [
  /^node:/,
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^@chakra-ui(?:\/|$)/,
  /^hono(?:\/|$)/,
  /^@hono(?:\/|$)/,
  /^@trpc(?:\/|$)/,
  /^@prisma(?:\/|$)/,
  /^@langwatch\/prisma-client(?:\/|$)/,
  /^@langwatch\/api(?:\/|$)/,
];

export type LegacyApplicationBoundaryKind =
  | "ee-alias"
  | "browser-to-backend"
  | "backend-to-browser"
  | "enterprise-to-application";

export type LegacyApplicationBoundaryEdge = {
  importer: string;
  specifier: string;
  kind: LegacyApplicationBoundaryKind;
};

type SourceImport = {
  file: string;
  line: number;
  specifier: string;
};

type LegacyBaselineDocument = {
  version: 1;
  edges: Partial<Record<LegacyApplicationBoundaryKind, Record<string, string[]>>>;
};

const legacyBaselineSchema = z
  .object({
    version: z.literal(1),
    edges: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  })
  .strict();

const LEGACY_KINDS: readonly LegacyApplicationBoundaryKind[] = [
  "backend-to-browser",
  "browser-to-backend",
  "ee-alias",
  "enterprise-to-application",
];

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  const escapesRoot =
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot === ".." ||
    isAbsolute(pathFromRoot);
  return pathFromRoot === "" || !escapesRoot;
}

function sourceLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function sourceLine(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function importsIn(file: string): SourceImport[] {
  const source = readFileSync(file, "utf8");
  const lineStarts = sourceLineStarts(source);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );
  const found: SourceImport[] = [];
  let mode: "export" | "import" | "require" | null = null;
  let acceptsString = false;

  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (token === ts.SyntaxKind.ImportKeyword) {
      mode = "import";
      acceptsString = true;
      continue;
    }
    if (token === ts.SyntaxKind.ExportKeyword) {
      mode = "export";
      acceptsString = false;
      continue;
    }
    if (token === ts.SyntaxKind.Identifier && scanner.getTokenText() === "require") {
      mode = "require";
      acceptsString = true;
      continue;
    }
    if (token === ts.SyntaxKind.FromKeyword && mode !== null) {
      acceptsString = true;
      continue;
    }
    if (token === ts.SyntaxKind.StringLiteral && mode && acceptsString) {
      found.push({
        file,
        line: sourceLine(lineStarts, scanner.getTokenPos()),
        specifier: scanner.getTokenValue(),
      });
      mode = null;
      acceptsString = false;
      continue;
    }
    if (
      mode === "import" &&
      token !== ts.SyntaxKind.OpenParenToken &&
      token !== ts.SyntaxKind.TypeKeyword
    ) {
      acceptsString = false;
    }
    if (
      token === ts.SyntaxKind.SemicolonToken ||
      token === ts.SyntaxKind.FunctionKeyword ||
      token === ts.SyntaxKind.ClassKeyword
    ) {
      mode = null;
      acceptsString = false;
    }
  }
  return found.sort(
    (left, right) =>
      left.line - right.line || left.specifier.localeCompare(right.specifier),
  );
}

function sourceImports(root: string): SourceImport[] {
  return walkFiles(root, (file) => {
    const isProductionSource =
      SOURCE_FILE.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
    const isNotTestDirectory =
      !file.includes(`${sep}__tests__${sep}`) && !file.includes(`${sep}__mocks__${sep}`);
    return isProductionSource && isNotTestDirectory;
  }).flatMap(importsIn);
}

function packageForSpecifier(
  packages: ClassifiedPackage[],
  specifier: string,
): ClassifiedPackage | undefined {
  return packages
    .filter((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

function packageForRelativeImport(
  packages: ClassifiedPackage[],
  sourceImport: SourceImport,
): ClassifiedPackage | undefined {
  if (!sourceImport.specifier.startsWith(".")) return void 0;
  const target = resolve(dirname(sourceImport.file), sourceImport.specifier);
  return packages.find((pkg) => isWithin(pkg.root, target));
}

function packageForPhysicalApplicationSpecifier(
  packages: ClassifiedPackage[],
  specifier: string,
): ClassifiedPackage | undefined {
  const match = specifier.match(/^(?:\.\/|\.\.\/)*apps\/(ui|api|worker|server)(?:\/|$)/);
  if (!match) return void 0;
  return packages.find(
    (pkg) => pkg.kind === "application" && pkg.applicationRole === match[1],
  );
}

function targetPackage(
  packages: ClassifiedPackage[],
  sourceImport: SourceImport,
): ClassifiedPackage | undefined {
  return (
    packageForSpecifier(packages, sourceImport.specifier) ??
    packageForRelativeImport(packages, sourceImport) ??
    packageForPhysicalApplicationSpecifier(packages, sourceImport.specifier)
  );
}

function compatibleEnterpriseTarget(
  role: EnterpriseCompositionRole | undefined,
  target: ClassifiedPackage,
): boolean {
  if (target.kind === "contract") return true;
  if (!target.enterprise || !target.feature) return false;
  if (role === "web") return target.kind === "web";
  return target.kind === "server";
}

function matchingEnterpriseComposition(
  importer: ClassifiedPackage,
  target: ClassifiedPackage,
): boolean {
  if (target.kind !== "enterprise-composition") return true;
  if (importer.kind !== "application") return false;
  if (importer.applicationRole === "ui") {
    return target.enterpriseCompositionRole === "web";
  }
  return importer.applicationRole === target.enterpriseCompositionRole;
}

function lintClassifiedSourceImports(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const sourcePackages = packages.filter((pkg) =>
    ["application", "dev-runtime", "enterprise-root", "enterprise-composition"].includes(
      pkg.kind,
    ),
  );

  for (const pkg of sourcePackages) {
    for (const sourceImport of sourceImports(join(pkg.root, "src"))) {
      const resolvedTarget = targetPackage(packages, sourceImport);
      const target = resolvedTarget === pkg ? void 0 : resolvedTarget;
      if (pkg.kind === "application" && target?.kind === "application") {
        violations.push({
          policy: "application-boundary",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `Application ${pkg.applicationRole} cannot import application ${target.applicationRole} source.`,
          allowed:
            "Move reusable behaviour to its owning feature or infrastructure package.",
        });
      }

      if (
        target?.kind === "enterprise-composition" &&
        !matchingEnterpriseComposition(pkg, target)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `${pkg.name} cannot import the ${target.enterpriseCompositionRole} Enterprise composition.`,
          allowed:
            pkg.kind === "application"
              ? `Use only the Enterprise composition matching apps/${pkg.applicationRole}.`
              : "Only the matching application composition root may consume this package.",
        });
      }

      if (
        pkg.kind === "enterprise-composition" &&
        target?.kind === "enterprise-composition"
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message:
            "Enterprise API, worker, and web composition packages cannot import one another.",
        });
      } else if (
        pkg.kind === "enterprise-composition" &&
        target?.feature &&
        !compatibleEnterpriseTarget(pkg.enterpriseCompositionRole, target)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `The ${pkg.enterpriseCompositionRole} Enterprise composition cannot import ${target.kind} surface ${target.name}.`,
          allowed:
            pkg.enterpriseCompositionRole === "web"
              ? "Depend only on portable contracts and Enterprise web surfaces."
              : `Depend only on portable contracts and Enterprise ${pkg.enterpriseCompositionRole} or server installers.`,
        });
      }

      const hasImplementationTarget = target !== void 0 && target.kind !== "contract";
      const hasForbiddenRuntimeImport = ENTERPRISE_ROOT_RUNTIME_IMPORT.some((pattern) =>
        pattern.test(sourceImport.specifier),
      );
      if (
        pkg.kind === "enterprise-root" &&
        (hasImplementationTarget || hasForbiddenRuntimeImport)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message:
            "The portable Enterprise catalogue cannot import runtime, transport, persistence, UI, or feature implementation source.",
          allowed: "Depend only on portable feature contracts.",
        });
      }
    }
  }
  return violations;
}

function lintCompositionSourceShape(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    if (
      pkg.kind !== "dev-runtime" &&
      pkg.kind !== "enterprise-root" &&
      pkg.kind !== "enterprise-composition"
    ) {
      continue;
    }
    const files = walkFiles(join(pkg.root, "src"), (file) => SOURCE_FILE.test(file));
    for (const file of files) {
      const relativeFile = workspacePath(join(pkg.root, "src"), file);
      if (!PRODUCT_IMPLEMENTATION_PATH.test(relativeFile)) continue;
      violations.push({
        policy: "composition-source",
        file,
        message: `${pkg.name} cannot contain product implementation module ${JSON.stringify(relativeFile)}.`,
        allowed:
          pkg.kind === "enterprise-root"
            ? "Move the implementation to its Enterprise feature surface."
            : "Keep only runtime composition and move the implementation to its owning feature package.",
      });
    }

    if (pkg.kind !== "enterprise-composition") continue;
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    if (
      !/export\s+(?:default\s+)?class\s+[A-Za-z_$][\w$]*/.test(source) ||
      !/static\s+create\s*\(/.test(source)
    ) {
      violations.push({
        policy: "composition-source",
        file: join(pkg.root, "src"),
        message:
          "An Enterprise composition package must export a composition class with static create.",
      });
    }
  }
  return violations;
}

function lintRuntimeConstructionImports(
  root: string,
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const importers = [
    ...sourceImports(join(root, "apps")),
    ...sourceImports(join(root, "tools")),
  ];
  const groups = new Map<string, Set<string>>();
  for (const sourceImport of importers) {
    if (
      sourceImport.specifier !== API_RUNTIME &&
      sourceImport.specifier !== WORKER_RUNTIME
    ) {
      continue;
    }
    const file = workspacePath(root, sourceImport.file);
    const match = file.match(/^(apps|tools)\/([^/]+)\//);
    if (!match) continue;
    const packageRoot = `${match[1]}/${match[2]}`;
    const known = groups.get(packageRoot) ?? new Set<string>();
    known.add(sourceImport.specifier);
    groups.set(packageRoot, known);
  }

  for (const [packageRoot, imports] of groups) {
    if (
      imports.has(API_RUNTIME) &&
      imports.has(WORKER_RUNTIME) &&
      packageRoot !== "tools/dev-runtime"
    ) {
      violations.push({
        policy: "application-boundary",
        file: join(root, packageRoot, "src"),
        message: `${packageRoot} imports both API and worker runtime construction entry points.`,
        allowed:
          "Only the private tools/dev-runtime contributor composition may combine both runtimes.",
      });
    }
  }

  const devRuntime = packages.find((pkg) => pkg.kind === "dev-runtime");
  if (!devRuntime) return violations;
  const devImports = groups.get("tools/dev-runtime") ?? new Set<string>();
  for (const required of [API_RUNTIME, WORKER_RUNTIME]) {
    if (devImports.has(required)) continue;
    violations.push({
      policy: "application-boundary",
      file: join(devRuntime.root, "src"),
      specifier: required,
      message: `tools/dev-runtime must compose ${required}.`,
    });
  }

  for (const role of ["api", "worker"] as const) {
    const application = packages.find(
      (pkg) => pkg.kind === "application" && pkg.applicationRole === role,
    );
    if (!application || exportedSubpaths(application).has("./runtime")) {
      continue;
    }
    violations.push({
      policy: "application-boundary",
      file: application.manifestPath,
      specifier: "./runtime",
      message: `${application.name} must deliberately export its runtime construction entry point for tools/dev-runtime.`,
    });
  }
  return violations;
}

type LegacyArea = "browser" | "backend" | "enterprise" | "unknown";

function legacyArea(legacyRoot: string, file: string): LegacyArea {
  const path = workspacePath(legacyRoot, file);
  if (path.startsWith("ee/")) return "enterprise";
  if (!path.startsWith("src/")) return "unknown";
  const sourcePath = path.slice("src/".length);
  if (
    /^(?:server|app\/api|pages\/api|mcp|tasks|runtime\/(?:app|worker|combined|testing))(?:\/|$)/.test(
      sourcePath,
    ) ||
    /^(?:server\.mts|start\.ts|workers\.ts)$/.test(sourcePath)
  ) {
    return "backend";
  }
  if (/^(?:generated|factories|test-utils|types|utils)(?:\/|$)/.test(sourcePath)) {
    return "unknown";
  }
  return "browser";
}

function resolveLegacySpecifier(
  legacyRoot: string,
  sourceImport: SourceImport,
): string | undefined {
  if (sourceImport.specifier.startsWith("@ee/")) {
    return join(legacyRoot, "ee", sourceImport.specifier.slice("@ee/".length));
  }
  if (sourceImport.specifier.startsWith("~/")) {
    return join(legacyRoot, "src", sourceImport.specifier.slice(2));
  }
  if (sourceImport.specifier.startsWith("@app/")) {
    return join(
      legacyRoot,
      "src",
      "server",
      "app-layer",
      sourceImport.specifier.slice("@app/".length),
    );
  }
  if (sourceImport.specifier.startsWith(".")) {
    return resolve(dirname(sourceImport.file), sourceImport.specifier);
  }
  return void 0;
}

function legacyEdgeKey(edge: LegacyApplicationBoundaryEdge): string {
  return `${edge.kind}\0${edge.importer}\0${edge.specifier}`;
}

function legacyKind(
  importer: LegacyArea,
  target: LegacyArea,
  specifier: string,
): LegacyApplicationBoundaryKind | undefined {
  if (specifier.startsWith("@ee/")) return "ee-alias";
  if (importer === "browser" && target === "backend") {
    return "browser-to-backend";
  }
  if (importer === "backend" && target === "browser") {
    return "backend-to-browser";
  }
  if (importer === "enterprise" && target !== "enterprise" && target !== "unknown") {
    return "enterprise-to-application";
  }
  return void 0;
}

export function collectLegacyApplicationBoundaryEdges(
  root: string,
): LegacyApplicationBoundaryEdge[] {
  const legacyRoot = join(root, "platform", "app");
  const edges = new Map<string, LegacyApplicationBoundaryEdge>();
  const imports = [
    ...sourceImports(join(legacyRoot, "src")),
    ...sourceImports(join(legacyRoot, "ee")),
  ];
  for (const sourceImport of imports) {
    const target = resolveLegacySpecifier(legacyRoot, sourceImport);
    const kind = legacyKind(
      legacyArea(legacyRoot, sourceImport.file),
      target ? legacyArea(legacyRoot, target) : "unknown",
      sourceImport.specifier,
    );
    if (!kind) continue;
    const edge = {
      importer: workspacePath(root, sourceImport.file),
      specifier: sourceImport.specifier,
      kind,
    };
    edges.set(legacyEdgeKey(edge), edge);
  }
  return [...edges.values()].sort((left, right) =>
    legacyEdgeKey(left).localeCompare(legacyEdgeKey(right)),
  );
}

export function formatLegacyApplicationBoundaryBaseline(
  edges: readonly LegacyApplicationBoundaryEdge[],
): string {
  const grouped = new Map<LegacyApplicationBoundaryKind, Map<string, string[]>>();
  for (const edge of [...edges].sort((left, right) =>
    legacyEdgeKey(left).localeCompare(legacyEdgeKey(right)),
  )) {
    const importers = grouped.get(edge.kind) ?? new Map<string, string[]>();
    const specifiers = importers.get(edge.importer) ?? [];
    specifiers.push(edge.specifier);
    importers.set(edge.importer, specifiers);
    grouped.set(edge.kind, importers);
  }

  const lines = ["{", '  "version": 1,', '  "edges": {'];
  const populatedKinds = LEGACY_KINDS.filter((kind) => grouped.has(kind));
  for (const [kindIndex, kind] of populatedKinds.entries()) {
    lines.push(`    ${JSON.stringify(kind)}: {`);
    const importers = [...(grouped.get(kind) ?? new Map()).entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [importerIndex, [importer, specifiers]] of importers.entries()) {
      const sortedSpecifiers = [...new Set(specifiers)].sort();
      lines.push(
        `      ${JSON.stringify(importer)}: ${JSON.stringify(sortedSpecifiers)}${importerIndex + 1 === importers.length ? "" : ","}`,
      );
    }
    lines.push(`    }${kindIndex + 1 === populatedKinds.length ? "" : ","}`);
  }
  lines.push("  }", "}");
  return `${lines.join("\n")}\n`;
}

function readLegacyBaseline(root: string): {
  baseline: LegacyApplicationBoundaryEdge[];
  violations: ArchitectureViolation[];
} {
  const path = join(root, LEGACY_BASELINE_PATH);
  if (!existsSync(path)) return { baseline: [], violations: [] };
  const violations: ArchitectureViolation[] = [];
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      baseline: [],
      violations: [
        {
          policy: "application-migration-baseline",
          file: path,
          message: `Legacy application boundary baseline must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const documentResult = legacyBaselineSchema.safeParse(value);
  if (!documentResult.success) {
    return {
      baseline: [],
      violations: [
        {
          policy: "application-migration-baseline",
          file: path,
          message:
            "Legacy application boundary baseline must contain version 1 and a grouped edges object.",
        },
      ],
    };
  }

  const baseline: LegacyApplicationBoundaryEdge[] = [];
  const document = documentResult.data;
  const edges = document.edges as LegacyBaselineDocument["edges"];
  const kindKeys = Object.keys(edges);
  const canonicalKinds = LEGACY_KINDS.filter((kind) => kindKeys.includes(kind));
  if (kindKeys.some((kind, index) => kind !== canonicalKinds[index])) {
    violations.push({
      policy: "application-migration-baseline",
      file: path,
      message: "Legacy application boundary baseline kinds are invalid or unsorted.",
    });
  }
  for (const kind of canonicalKinds) {
    const importers = edges[kind];
    if (typeof importers !== "object" || importers === null || Array.isArray(importers)) {
      violations.push({
        policy: "application-migration-baseline",
        file: path,
        message: `Legacy application boundary baseline group ${kind} is invalid.`,
      });
      continue;
    }
    const importerKeys = Object.keys(importers);
    if (
      importerKeys.some(
        (importer, index) =>
          importer !==
          [...importerKeys].sort((left, right) => left.localeCompare(right))[index],
      )
    ) {
      violations.push({
        policy: "application-migration-baseline",
        file: path,
        message: `Legacy application boundary baseline group ${kind} must sort importers.`,
      });
    }
    for (const importer of importerKeys) {
      const specifiers = importers[importer];
      if (
        !Array.isArray(specifiers) ||
        specifiers.length === 0 ||
        specifiers.some((specifier) => typeof specifier !== "string")
      ) {
        violations.push({
          policy: "application-migration-baseline",
          file: path,
          message: `Legacy application boundary baseline importer ${importer} has invalid specifiers.`,
        });
        continue;
      }
      const sortedSpecifiers = [...specifiers].sort();
      if (
        new Set(specifiers).size !== specifiers.length ||
        specifiers.some((specifier, index) => specifier !== sortedSpecifiers[index])
      ) {
        violations.push({
          policy: "application-migration-baseline",
          file: path,
          message: `Legacy application boundary baseline importer ${importer} must have unique sorted specifiers.`,
        });
      }
      for (const specifier of specifiers) {
        baseline.push({ kind, importer, specifier });
      }
    }
  }
  const keys = baseline.map(legacyEdgeKey);
  if (new Set(keys).size !== keys.length) {
    violations.push({
      policy: "application-migration-baseline",
      file: path,
      message: "Legacy application boundary baseline contains duplicate edges.",
    });
  }
  return { baseline, violations };
}

function lintLegacyApplicationBoundaries(root: string): ArchitectureViolation[] {
  const path = join(root, LEGACY_BASELINE_PATH);
  const { baseline, violations } = readLegacyBaseline(root);
  const actual = collectLegacyApplicationBoundaryEdges(root);
  if (existsSync(path) && baseline.length === 0 && violations.length === 0) {
    violations.push({
      policy: "application-migration-baseline",
      file: path,
      message:
        "An empty legacy application boundary baseline must be deleted rather than retained as an exception surface.",
    });
  }
  const actualByKey = new Map(actual.map((edge) => [legacyEdgeKey(edge), edge]));
  const baselineByKey = new Map(baseline.map((edge) => [legacyEdgeKey(edge), edge]));

  for (const edge of actual) {
    if (baselineByKey.has(legacyEdgeKey(edge))) continue;
    violations.push({
      policy: "application-migration",
      file: join(root, edge.importer),
      specifier: edge.specifier,
      message: `New legacy application boundary edge (${edge.kind}) is not permitted.`,
      allowed:
        "Move the dependency behind a portable feature/package boundary; the migration baseline may not grow.",
    });
  }
  for (const edge of baseline) {
    if (actualByKey.has(legacyEdgeKey(edge))) continue;
    violations.push({
      policy: "application-migration-baseline",
      file: path,
      specifier: edge.specifier,
      message: `Baseline edge from ${edge.importer} no longer exists and must be removed.`,
      allowed: "Delete the stale entry so the checked-in baseline only shrinks.",
    });
  }
  return violations;
}

function lintNewEnterpriseAliases(root: string): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const directory of ["apps", "packages", "tools"] as const) {
    for (const sourceImport of sourceImports(join(root, directory))) {
      if (!sourceImport.specifier.startsWith("@ee/")) continue;
      violations.push({
        policy: "application-migration",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: "The legacy @ee alias cannot be introduced outside platform/app.",
        allowed: "Import the owning @langwatch/enterprise-<feature>-<surface> package.",
      });
    }
  }
  return violations;
}

export function lintApplicationBoundaries(
  root: string,
  packages: ClassifiedPackage[],
  options?: { legacyMigration?: boolean },
): ArchitectureViolation[] {
  return [
    ...lintClassifiedSourceImports(packages),
    ...lintCompositionSourceShape(packages),
    ...lintRuntimeConstructionImports(root, packages),
    ...(options?.legacyMigration === false
      ? []
      : [...lintLegacyApplicationBoundaries(root), ...lintNewEnterpriseAliases(root)]),
  ];
}
