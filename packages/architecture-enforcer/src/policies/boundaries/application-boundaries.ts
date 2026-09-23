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
  let mode: "export" | "import" | "require" | null = null;
  let acceptsString = false;

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
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

function lintClassifiedSourceImports(
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  const sourcePackages = packages.filter((pkg) =>
    ["application", "dev-runtime", "enterprise-root", "enterprise-composition"].includes(pkg.kind),
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
          allowed: "Move reusable behaviour to its owning feature or infrastructure package.",
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

      if (pkg.kind === "enterprise-composition" && target?.kind === "enterprise-composition") {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: "Enterprise API and worker composition packages cannot import one another.",
        });
      } else if (
        pkg.kind === "enterprise-composition" &&
        target?.feature &&
        !compatibleEnterpriseTarget(target)
      ) {
        violations.push({
          policy: "enterprise-composition",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: `The ${pkg.enterpriseCompositionRole} Enterprise composition cannot import ${target.kind} surface ${target.name}.`,
          allowed: `Depend only on portable contracts and Enterprise ${pkg.enterpriseCompositionRole} or server installers.`,
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
