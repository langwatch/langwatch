import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const API_RUNTIME = "@langwatch/platform-api";
const WORKER_RUNTIME = "@langwatch/worker";

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

type SourceImport = {
  file: string;
  line: number;
  specifier: string;
};

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);

  const escapesRoot =
    pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || isAbsolute(pathFromRoot);

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

type ImportScan = { mode: "export" | "import" | "require" | null; acceptsString: boolean };

const IMPORT_TERMINATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.FunctionKeyword,
  ts.SyntaxKind.ClassKeyword,
]);

/**
 * The scanner state after one non-specifier token: `import`, `export` and
 * `require` open a statement, `from` re-opens the specifier slot, and a
 * semicolon, function or class closes it.
 */
function scanAfterToken({
  scan,
  token,
  text,
}: {
  scan: ImportScan;
  token: ts.SyntaxKind;
  text: string;
}): ImportScan {
  if (token === ts.SyntaxKind.ImportKeyword) return { mode: "import", acceptsString: true };
  if (token === ts.SyntaxKind.ExportKeyword) return { mode: "export", acceptsString: false };
  if (token === ts.SyntaxKind.Identifier && text === "require") {
    return { mode: "require", acceptsString: true };
  }
  if (token === ts.SyntaxKind.FromKeyword && scan.mode !== null) {
    return { ...scan, acceptsString: true };
  }
  if (IMPORT_TERMINATORS.has(token)) return { mode: null, acceptsString: false };
  const keepsImportSlot =
    token === ts.SyntaxKind.OpenParenToken || token === ts.SyntaxKind.TypeKeyword;
  if (scan.mode === "import" && !keepsImportSlot) return { ...scan, acceptsString: false };
  return scan;
}

function importsIn(file: string): SourceImport[] {
  const source = sourceText({ file });
  const lineStarts = sourceLineStarts(source);

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    source,
  );

  const found: SourceImport[] = [];
  let scan: ImportScan = { mode: null, acceptsString: false };

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.StringLiteral && scan.mode && scan.acceptsString) {
      found.push({
        file,
        line: sourceLine(lineStarts, scanner.getTokenPos()),
        specifier: scanner.getTokenValue(),
      });
      scan = { mode: null, acceptsString: false };
      continue;
    }
    const text = token === ts.SyntaxKind.Identifier ? scanner.getTokenText() : "";
    scan = scanAfterToken({ scan, token, text });
  }

  return found.toSorted(
    (left, right) => left.line - right.line || left.specifier.localeCompare(right.specifier),
  );
}

function sourceImports(root: string): SourceImport[] {
  return listFiles({
    directory: root,
    accept: (file) => {
      const isProductionSource =
        SOURCE_FILE.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

      const isNotTestDirectory =
        !file.includes(`${sep}__tests__${sep}`) && !file.includes(`${sep}__mocks__${sep}`);

      return isProductionSource && isNotTestDirectory;
    },
  }).flatMap(importsIn);
}

function packageForSpecifier(
  packages: readonly ClassifiedPackage[],
  specifier: string,
): ClassifiedPackage | undefined {
  return packages
    .filter((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))
    .toSorted((left, right) => right.name.length - left.name.length)[0];
}

function packageForRelativeImport(
  packages: readonly ClassifiedPackage[],
  sourceImport: SourceImport,
): ClassifiedPackage | undefined {
  if (!sourceImport.specifier.startsWith(".")) return void 0;

  const target = resolve(dirname(sourceImport.file), sourceImport.specifier);

  return packages.find((pkg) => isWithin(pkg.root, target));
}

function packageForPhysicalApplicationSpecifier(
  packages: readonly ClassifiedPackage[],
  specifier: string,
): ClassifiedPackage | undefined {
  const match = specifier.match(/^(?:\.\/|\.\.\/)*apps\/(ui|api|worker|server|tasks)(?:\/|$)/);
  if (!match) return void 0;

  return packages.find((pkg) => pkg.kind === "application" && pkg.applicationRole === match[1]);
}

function targetPackage(
  packages: readonly ClassifiedPackage[],
  sourceImport: SourceImport,
): ClassifiedPackage | undefined {
  return (
    packageForSpecifier(packages, sourceImport.specifier) ??
    packageForRelativeImport(packages, sourceImport) ??
    packageForPhysicalApplicationSpecifier(packages, sourceImport.specifier)
  );
}

function compatibleEnterpriseTarget(target: ClassifiedPackage): boolean {
  if (target.kind === "contract") return true;

  return Boolean(target.enterprise && target.feature && target.kind === "process");
}

function matchingEnterpriseComposition(
  importer: ClassifiedPackage,
  target: ClassifiedPackage,
): boolean {
  if (target.kind !== "enterprise-composition") return true;

  if (importer.kind !== "application") return false;

  return importer.applicationRole === target.enterpriseCompositionRole;
}

type SourceImportRule = (input: {
  pkg: ClassifiedPackage;
  target: ClassifiedPackage | undefined;
  sourceImport: SourceImport;
}) => ArchitectureViolation[];

const applicationImportsApplication: SourceImportRule = ({ pkg, target, sourceImport }) => {
  if (pkg.kind === "application" && target?.kind === "application") {
    return [
      {
        policy: "application-boundary",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: `Application ${pkg.applicationRole} cannot import application ${target.applicationRole} source.`,
        allowed: "Move reusable behaviour to its owning feature or infrastructure package.",
      },
    ];
  }
  return [];
};

const mismatchedEnterpriseComposition: SourceImportRule = ({ pkg, target, sourceImport }) => {
  if (target?.kind === "enterprise-composition" && !matchingEnterpriseComposition(pkg, target)) {
    return [
      {
        policy: "enterprise-composition",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: `${pkg.name} cannot import the ${target.enterpriseCompositionRole} Enterprise composition.`,
        allowed:
          pkg.kind === "application"
            ? `Use only the Enterprise composition matching apps/${pkg.applicationRole}.`
            : "Only the matching application composition root may consume this package.",
      },
    ];
  }
  return [];
};

const crossedEnterpriseComposition: SourceImportRule = ({ pkg, target, sourceImport }) => {
  if (pkg.kind === "enterprise-composition" && target?.kind === "enterprise-composition") {
    return [
      {
        policy: "enterprise-composition",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: "Enterprise API and worker composition packages cannot import one another.",
      },
    ];
  } else if (
    pkg.kind === "enterprise-composition" &&
    target?.feature &&
    !compatibleEnterpriseTarget(target)
  ) {
    return [
      {
        policy: "enterprise-composition",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message: `The ${pkg.enterpriseCompositionRole} Enterprise composition cannot import ${target.kind} surface ${target.name}.`,
        allowed: `Depend only on portable contracts and Enterprise ${pkg.enterpriseCompositionRole} or server installers.`,
      },
    ];
  }
  return [];
};

const enterpriseRootImportsRuntime: SourceImportRule = ({ pkg, target, sourceImport }) => {
  const hasImplementationTarget = target !== void 0 && target.kind !== "contract";

  const hasForbiddenRuntimeImport = ENTERPRISE_ROOT_RUNTIME_IMPORT.some((pattern) =>
    pattern.test(sourceImport.specifier),
  );

  if (pkg.kind === "enterprise-root" && (hasImplementationTarget || hasForbiddenRuntimeImport)) {
    return [
      {
        policy: "enterprise-composition",
        file: sourceImport.file,
        line: sourceImport.line,
        specifier: sourceImport.specifier,
        message:
          "The portable Enterprise catalogue cannot import runtime, transport, persistence, UI, or feature implementation source.",
        allowed: "Depend only on portable feature contracts.",
      },
    ];
  }
  return [];
};

/** Every rule a classified package's source import answers to, in reporting order. */
const SOURCE_IMPORT_RULES: readonly SourceImportRule[] = [
  applicationImportsApplication,
  mismatchedEnterpriseComposition,
  crossedEnterpriseComposition,
  enterpriseRootImportsRuntime,
];

function lintClassifiedSourceImports(
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const sourcePackages = packages.filter((pkg) =>
    ["application", "dev-runtime", "enterprise-root", "enterprise-composition"].includes(pkg.kind),
  );

  return sourcePackages.flatMap((pkg) =>
    sourceImports(join(pkg.root, "src")).flatMap((sourceImport) => {
      const resolvedTarget = targetPackage(packages, sourceImport);
      const target = resolvedTarget === pkg ? void 0 : resolvedTarget;
      return SOURCE_IMPORT_RULES.flatMap((rule) => rule({ pkg, target, sourceImport }));
    }),
  );
}

function productImplementationViolations({
  pkg,
  files,
}: {
  pkg: ClassifiedPackage;
  files: readonly string[];
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

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

  return violations;
}

function lintCompositionSourceShape(
  packages: readonly ClassifiedPackage[],
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

    const files = listFiles({
      directory: join(pkg.root, "src"),
      accept: (file) => SOURCE_FILE.test(file),
    });

    violations.push(...productImplementationViolations({ pkg, files }));

    if (pkg.kind !== "enterprise-composition") continue;

    const source = files.map((file) => sourceText({ file })).join("\n");

    if (!/export\s+(?:default\s+)?class\s+[A-Za-z_$][\w$]*/.test(source)) {
      violations.push({
        policy: "composition-source",
        file: join(pkg.root, "src"),
        message:
          "An Enterprise composition package must export a composition class with static create.",
      });

      continue;
    }

    if (!/static\s+create\s*\(/.test(source)) {
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

function combinedRuntimeViolations({
  root,
  groups,
}: {
  root: string;
  groups: ReadonlyMap<string, ReadonlySet<string>>;
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const [packageRoot, imports] of groups) {
    if (!imports.has(API_RUNTIME)) continue;

    if (!imports.has(WORKER_RUNTIME)) continue;

    if (packageRoot === "tools/dev-runtime") continue;

    violations.push({
      policy: "application-boundary",
      file: join(root, packageRoot, "src"),
      message: `${packageRoot} imports both API and worker runtime construction entry points.`,
      allowed:
        "Only the private tools/dev-runtime contributor composition may combine both runtimes.",
    });
  }

  return violations;
}

function lintRuntimeConstructionImports(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const importers = [...sourceImports(join(root, "apps")), ...sourceImports(join(root, "tools"))];
  const groups = new Map<string, Set<string>>();

  for (const sourceImport of importers) {
    if (sourceImport.specifier !== API_RUNTIME && sourceImport.specifier !== WORKER_RUNTIME) {
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

  violations.push(...combinedRuntimeViolations({ root, groups }));

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

  return violations;
}

export function lintApplicationBoundaries(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root, packages } = snapshot;

  return [
    ...lintClassifiedSourceImports(packages),
    ...lintCompositionSourceShape(packages),
    ...lintRuntimeConstructionImports(root, packages),
  ];
}
