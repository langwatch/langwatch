import { existsSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type {
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureCatalogueEntry,
} from "./types";

const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const CONTRACT_ARTIFACT = new RegExp(
  `^${NAME}\\.(?:commands|errors|events|queries|service)\\.ts$`,
);
const SERVER_ONLY_CONTRACT_ARTIFACT =
  /\.(?:adapter|api|mapper|migration|port|projection|repository|store)\.ts$/;
const CONTRACT_ARTIFACT_SUFFIX =
  /\.(?:commands|errors|events|queries|service)\.ts$/;
const SERVER_PATTERNS = [
  /^index\.ts$/,
  /^testing\.ts$/,
  new RegExp(`^fixtures/${NAME}\\.fixture\\.ts$`),
  new RegExp(`^services/${NAME}\\.service\\.ts$`),
  new RegExp(`^ports/${NAME}\\.port\\.ts$`),
  new RegExp(`^repositories/${NAME}\\.repository\\.ts$`),
  new RegExp(
    `^repositories/(${NAME})/\\1\\.${NAME}\\.(?:mapper|repository)\\.ts$`,
  ),
  new RegExp(`^stores/${NAME}\\.store\\.ts$`),
  new RegExp(`^stores/(${NAME})/\\1\\.${NAME}\\.store\\.ts$`),
  new RegExp(`^projections/${NAME}\\.projection\\.ts$`),
  new RegExp(`^subscribers/${NAME}\\.subscriber\\.ts$`),
  new RegExp(`^processes/${NAME}\\.process\\.ts$`),
  new RegExp(`^intents/${NAME}\\.intent\\.ts$`),
  new RegExp(`^adapters/${NAME}\\.${NAME}\\.adapter\\.ts$`),
  new RegExp(`^api/${NAME}/${NAME}\\.api\\.ts$`),
  new RegExp(`^migrations/${NAME}-import\\.${NAME}\\.migration\\.ts$`),
] as const;

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function violation(
  file: string,
  message: string,
  allowed: string,
): ArchitectureViolation {
  return { policy: "feature-source-layout", file, message, allowed };
}

function lintContract(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) =>
    /\.[cm]?[jt]sx?$/.test(path),
  );
  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name === "index.ts") continue;

    if (/^(?:commands|errors|events|queries|service)\.ts$/.test(name)) {
      violations.push(
        violation(
          file,
          `Contract artifact ${JSON.stringify(name)} is missing its subject.`,
          "Use <subject>.<artifact>.ts, for example agent.service.ts.",
        ),
      );
      continue;
    }
    if (SERVER_ONLY_CONTRACT_ARTIFACT.test(name)) {
      violations.push(
        violation(
          file,
          `Server artifact ${JSON.stringify(name)} cannot live in contract source.`,
          "Move runtime implementations to the matching server/src directory.",
        ),
      );
      continue;
    }
    if (CONTRACT_ARTIFACT_SUFFIX.test(name)) {
      if (!CONTRACT_ARTIFACT.test(name)) {
        violations.push(
          violation(
            file,
            `Contract artifact filename ${JSON.stringify(name)} is not lower-case kebab case.`,
            "Use <subject>.<artifact>.ts.",
          ),
        );
      } else if (name.endsWith(".service.ts")) {
        serviceCount += 1;
      }
    }
  }

  if (serviceCount === 0) {
    violations.push(
      violation(
        `${pkg.root}/src`,
        "A strict contract package must declare its service capability in a subject-named module.",
        "Add src/<subject>.service.ts and export it from src/index.ts.",
      ),
    );
  }
  return violations;
}

function lintServer(pkg: ClassifiedPackage): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) =>
    /\.[cm]?[jt]sx?$/.test(path),
  );
  let serviceCount = 0;

  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (/^services\/.+-process\.service\.ts$/.test(path)) {
      violations.push(
        violation(
          file,
          `Process manager source ${JSON.stringify(path)} cannot masquerade as a service.`,
          "Move pure evolution to processes/<subject>.process.ts and retry-safe external work to intents/<subject>.intent.ts.",
        ),
      );
      continue;
    }
    if (SERVER_PATTERNS.some((pattern) => pattern.test(path))) {
      if (/^services\/.+\.service\.ts$/.test(path)) serviceCount += 1;
      continue;
    }
    violations.push(
      violation(
        file,
        `Server source path ${JSON.stringify(path)} is not part of strict layout version 0.`,
        "Use services, repositories, stores, projections, subscribers, processes, intents, ports, adapters, api/<surface>, or migrations with the canonical filename grammar.",
      ),
    );
  }

  if (serviceCount === 0) {
    violations.push(
      violation(
        `${pkg.root}/src/services`,
        "A strict server package must contain a subject-named service class module.",
        "Add src/services/<subject>.service.ts.",
      ),
    );
  }
  return violations;
}

const PRIVATE_SERVER_EXPORT =
  /(?:^|\/)(?:projections|repositories|stores)(?:\/|$)/;

function lintPrivateServerExports(
  pkg: ClassifiedPackage,
): ArchitectureViolation[] {
  const file = `${pkg.root}/src/index.ts`;
  if (!existsSync(file)) return [];
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const privateImports = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  const add = (node: ts.Node, specifier?: string): void => {
    violations.push({
      policy: "private-runtime-export",
      file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      specifier,
      message:
        "A feature server root cannot expose a repository, store, or projection implementation.",
      allowed:
        "Export the composition adapter and service; keep persistence and projection modules private to the feature server.",
    });
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      PRIVATE_SERVER_EXPORT.test(statement.moduleSpecifier.text)
    ) {
      const clause = statement.importClause;
      if (clause?.name) privateImports.add(clause.name.text);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          privateImports.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            privateImports.add(element.name.text);
          }
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    if (
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      PRIVATE_SERVER_EXPORT.test(statement.moduleSpecifier.text)
    ) {
      add(statement, statement.moduleSpecifier.text);
      continue;
    }
    if (
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = element.propertyName?.text ?? element.name.text;
        if (privateImports.has(local)) add(element);
      }
    }
  }
  return violations;
}

const ARTIFACT_PARTS = new Set([
  "adapter",
  "api",
  "commands",
  "errors",
  "events",
  "fixture",
  "mapper",
  "migration",
  "port",
  "process",
  "projection",
  "queries",
  "repository",
  "service",
  "store",
  "subscriber",
  "intent",
]);
const QUALIFIED_ARTIFACTS = new Set([
  "adapter",
  "mapper",
  "migration",
  "repository",
  "store",
]);

function claimsSubject(
  candidate: string,
  feature: string,
  subject: string,
): boolean {
  if (candidate === subject) return true;
  return (
    candidate.startsWith(`${feature}-`) &&
    candidate.slice(feature.length + 1) === subject
  );
}

function claimedSubjects(path: string): string[] {
  const filename = path.slice(path.lastIndexOf("/") + 1, -3);
  const parts = filename.split(".");
  const artifact = parts.at(-1);
  if (
    parts.length >= 3 &&
    artifact &&
    QUALIFIED_ARTIFACTS.has(artifact)
  ) {
    return [parts.at(-2)!];
  }
  return parts.filter((part) => !ARTIFACT_PARTS.has(part));
}

function lintOwnedSubjects(
  pkg: ClassifiedPackage,
  catalogue: readonly FeatureCatalogueEntry[],
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  if (!pkg.subjects || (pkg.kind !== "contract" && pkg.kind !== "server")) {
    return [];
  }
  // Ownership is enforced once its canonical feature has a physical package
  // to consume. Dormant catalogue entries are migration intent, not a demand
  // for placeholder packages.
  const migratedFeatures = new Set<string>();
  for (const candidatePackage of packages) {
    if (candidatePackage.feature) migratedFeatures.add(candidatePackage.feature);
  }
  const subjectOwners = new Map<string, string>();
  for (const entry of catalogue) {
    if (!migratedFeatures.has(entry.id)) continue;
    for (const subject of entry.subjects) subjectOwners.set(subject, entry.id);
  }
  const violations: ArchitectureViolation[] = [];
  const files = walkFiles(`${pkg.root}/src`, (path) => /\.tsx?$/.test(path));
  for (const file of files) {
    const path = workspacePath(`${pkg.root}/src`, file);
    if (path === "index.ts") continue;
    if (!/\.(?:adapter|commands|errors|events|intent|process|projection|queries|repository|service|store|subscriber)\.tsx?$/.test(path)) {
      continue;
    }
    const candidates = claimedSubjects(path);
    const foreign = candidates.flatMap((candidate) =>
      [...subjectOwners].filter(
        ([subject, owner]) =>
          owner !== pkg.feature && claimsSubject(candidate, pkg.feature!, subject),
      ),
    );
    if (foreign.length === 0) continue;
    const [subject, owner] = foreign[0]!;
    violations.push({
      policy: "feature-source-subject",
      file,
      message: `Source module ${JSON.stringify(path)} claims ${JSON.stringify(subject)}, which belongs to the singular ${JSON.stringify(owner)} feature.`,
      allowed: `Move the implementation to ${owner}, then inject its contract service into ${pkg.feature}. Local feature.json changes cannot broaden ownership.`,
    });
  }
  return violations;
}

export function lintFeatureLayouts(
  packages: ClassifiedPackage[],
  catalogue: readonly FeatureCatalogueEntry[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    if (pkg.layoutVersion !== 0) continue;
    violations.push(...lintOwnedSubjects(pkg, catalogue, packages));
    if (pkg.kind === "contract") violations.push(...lintContract(pkg));
    if (pkg.kind === "server") {
      violations.push(...lintServer(pkg));
      violations.push(...lintPrivateServerExports(pkg));
    }
  }
  return violations;
}
