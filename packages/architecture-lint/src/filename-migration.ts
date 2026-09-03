import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import { isLowerKebabFilename } from "./feature-layout";
import { discoverClassifiedPackages } from "./workspace";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const CANONICAL_ARTIFACTS = new Set([
  "adapter",
  "api",
  "commands",
  "errors",
  "events",
  "intent",
  "migration",
  "port",
  "process",
  "projection",
  "queries",
  "repository",
  "service",
  "store",
  "subscriber",
]);

export type FilenameRename = {
  from: string;
  to: string;
};

export type FilenameMigrationPlan = {
  mappings: FilenameRename[];
  edits: Map<string, string>;
  collisions: string[];
  unresolved: string[];
  remainingTextualReferences: string[];
};

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function collapseRepeatedQualifiers(parts: string[]): string[] {
  const collapsed = [...parts];
  let changed = true;
  while (changed && collapsed.length > 1) {
    changed = false;
    for (let index = 0; index < collapsed.length - 1; index += 1) {
      const left = collapsed[index]!;
      const right = collapsed[index + 1]!;
      if (left === right || right.startsWith(`${left}-`)) {
        collapsed.splice(index, 1);
        changed = true;
        break;
      }
      if (left.startsWith(`${right}-`)) {
        collapsed.splice(index + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return collapsed;
}

function canonicalFilename(name: string): string {
  const extension = name.match(/\.[cm]?[jt]sx?$/)?.[0] ?? extname(name);
  const stem = name.slice(0, -extension.length);
  const parts = stem.split(".");
  const artifact = parts.at(-1);
  if (artifact && CANONICAL_ARTIFACTS.has(artifact) && parts.length > 2) {
    const qualifiers = collapseRepeatedQualifiers(parts.slice(0, -1).map(kebab));
    return `${qualifiers.join("-")}.${artifact}${extension}`;
  }
  return `${parts.map(kebab).join(".")}${extension}`;
}

function strictSourceFiles(root: string): string[] {
  const isFeatureSurface = (pkg: { kind: string }) =>
    pkg.kind === "contract" || pkg.kind === "server" || pkg.kind === "web";
  return discoverClassifiedPackages(root)
    .packages.filter((pkg) => pkg.layoutVersion === 0 && isFeatureSurface(pkg))
    .flatMap((pkg) => walkFiles(`${pkg.root}/src`, (path) => SOURCE_FILE.test(path)));
}

function repositoryFiles(root: string, accept: (path: string) => boolean): string[] {
  try {
    const output = execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return output
      .split("\0")
      .filter(Boolean)
      .map((path) => resolve(root, path))
      .filter((path) => existsSync(path) && accept(path));
  } catch {
    return walkFiles(root, accept);
  }
}

function relativeModuleTarget(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return void 0;
  const base = resolve(dirname(file), specifier);
  const javascriptExtension = specifier.match(/\.(?:m?js|cjs)$/)?.[0];
  const extensionless = javascriptExtension
    ? base.slice(0, -javascriptExtension.length)
    : base;
  const typedCandidates = [".ts", ".tsx", ".mts", ".cts"].map(
    (extension) => `${extensionless}${extension}`,
  );
  const candidates = [
    ...(javascriptExtension ? typedCandidates : [base, ...typedCandidates]),
    ...(javascriptExtension ? [base] : []),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
      (extension) => `${base}${extension}`,
    ),
    ...["index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.jsx"].map(
      (index) => resolve(base, index),
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function moduleSpecifierNodes(sourceFile: ts.SourceFile): ts.StringLiteral[] {
  const literals: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isStringLiteral(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const parent = node.parent;
    const isImportDeclaration =
      ts.isImportDeclaration(parent) && parent.moduleSpecifier === node;
    const isExportDeclaration =
      ts.isExportDeclaration(parent) && parent.moduleSpecifier === node;
    const isImportType =
      ts.isImportTypeNode(parent) &&
      ts.isLiteralTypeNode(parent.argument) &&
      parent.argument.literal === node;
    const isExternalModule =
      ts.isExternalModuleReference(parent) && parent.expression === node;
    const isCallWithFirstArgument =
      ts.isCallExpression(parent) && parent.arguments[0] === node;
    const isDynamicImport =
      isCallWithFirstArgument && parent.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequireCall = isCallWithFirstArgument && ts.isIdentifier(parent.expression);
    const isNamedRequire = isRequireCall && parent.expression.text === "require";
    const isDeclarationSpecifier =
      isImportDeclaration || isExportDeclaration || isImportType;
    const isRuntimeSpecifier = isExternalModule || isDynamicImport || isNamedRequire;
    if (isDeclarationSpecifier || isRuntimeSpecifier) {
      literals.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

function replaceModuleSpecifiers(
  file: string,
  source: string,
  mappings: Map<string, string>,
): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const literal of moduleSpecifierNodes(sourceFile)) {
    const target = relativeModuleTarget(file, literal.text);
    const renamed = target && mappings.get(target);
    if (!renamed) continue;
    let next = relative(dirname(file), renamed).split(sep).join("/");
    if (!next.startsWith(".")) next = `./${next}`;
    const sourceExtension = literal.text.match(/\.[cm]?[jt]sx?$/)?.[0];
    if (!sourceExtension) {
      next = next.replace(/\.[cm]?[jt]sx?$/, "");
    } else if (/\.(?:m?js|cjs)$/.test(sourceExtension)) {
      next = next.replace(/\.[cm]?[jt]sx?$/, sourceExtension);
    }
    replacements.push({
      start: literal.getStart(sourceFile) + 1,
      end: literal.getEnd() - 1,
      text: next,
    });
  }
  return applyReplacements(source, replacements);
}

function applyReplacements(
  source: string,
  replacements: Array<{ start: number; end: number; text: string }>,
): string {
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((current, replacement) => {
      return `${current.slice(0, replacement.start)}${replacement.text}${current.slice(replacement.end)}`;
    }, source);
}

function replaceJsonPaths(
  file: string,
  source: string,
  mappings: FilenameRename[],
): string {
  const sourceFile = ts.parseJsonText(file, source);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const pathMap = new Map<string, string>();
  for (const mapping of mappings) {
    const oldPath = relative(dirname(file), mapping.from).split(sep).join("/");
    const newPath = relative(dirname(file), mapping.to).split(sep).join("/");
    pathMap.set(oldPath, newPath);
    pathMap.set(`./${oldPath}`, `./${newPath}`);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      const replacement = pathMap.get(node.text);
      if (replacement) {
        replacements.push({
          start: node.getStart(sourceFile) + 1,
          end: node.getEnd() - 1,
          text: replacement,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return applyReplacements(source, replacements);
}

function documentationPathFiles(root: string): string[] {
  return repositoryFiles(root, (path) => /\.(?:md|mdx|feature|ya?ml)$/i.test(path));
}

function replaceDocumentationPaths(
  root: string,
  source: string,
  mappings: FilenameRename[],
): string {
  let output = source;
  for (const mapping of mappings) {
    const oldPath = relative(root, mapping.from).split(sep).join("/");
    const newPath = relative(root, mapping.to).split(sep).join("/");
    const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match full workspace-relative paths only; bare basenames and prose are
    // deliberately left alone.
    output = output.replace(
      new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}(?=$|[^A-Za-z0-9_./-])`, "g"),
      `$1${newPath}`,
    );
  }
  return output;
}

function documentationPathReferences(
  root: string,
  source: string,
  file: string,
  mappings: FilenameRename[],
): string[] {
  const references: string[] = [];
  for (const mapping of mappings) {
    const oldPath = relative(root, mapping.from).split(sep).join("/");
    const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}(?=$|[^A-Za-z0-9_./-])`).test(source)) {
      references.push(`${relative(root, file).split(sep).join("/")}: ${oldPath}`);
    }
  }
  return references;
}

export function collectFilenameMigrationMappings(rootInput: string): FilenameRename[] {
  const root = resolve(rootInput);
  const files = strictSourceFiles(root);
  const mappings: FilenameRename[] = [];
  for (const file of files) {
    const name = basename(file);
    if (name.endsWith(".d.ts") || isLowerKebabFilename(name)) continue;
    const target = resolve(dirname(file), canonicalFilename(name));
    if (target !== file) mappings.push({ from: file, to: target });
  }
  return mappings;
}

export function planFilenameMigration(rootInput: string): FilenameMigrationPlan {
  const root = resolve(rootInput);
  const mappings = collectFilenameMigrationMappings(root);

  const mappingBySource = new Map(mappings.map((mapping) => [mapping.from, mapping.to]));
  const targetOwners = new Map<string, string>();
  const collisions: string[] = [];
  for (const mapping of mappings) {
    const owner = targetOwners.get(mapping.to);
    if (owner && owner !== mapping.from)
      collisions.push(`${mapping.from} -> ${mapping.to} (also ${owner})`);
    targetOwners.set(mapping.to, mapping.from);
    if (mappingBySource.has(mapping.to)) {
      collisions.push(`${mapping.from} -> ${mapping.to} (target is also being renamed)`);
    } else if (existsSync(mapping.to)) {
      collisions.push(`${mapping.from} -> ${mapping.to} (target exists)`);
    }
  }

  const edits = new Map<string, string>();
  const unresolved: string[] = [];
  const sourceFiles = repositoryFiles(root, (path) => SOURCE_FILE.test(path));
  const sourceNeedles = mappings.map((mapping) =>
    basename(mapping.from).replace(/\.[cm]?[jt]sx?$/, ""),
  );
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    if (!sourceNeedles.some((needle) => source.includes(needle))) continue;
    const output = replaceModuleSpecifiers(file, source, mappingBySource);
    if (output !== source) edits.set(file, output);
  }
  const jsonFiles = repositoryFiles(root, (path) => {
    const name = basename(path);
    return name === "package.json" || /^tsconfig(?:\..+)?\.json$/.test(name);
  });
  for (const file of jsonFiles) {
    const source = readFileSync(file, "utf8");
    if (!sourceNeedles.some((needle) => source.includes(needle))) continue;
    const output = replaceJsonPaths(file, source, mappings);
    if (output !== source) edits.set(file, output);
  }

  const remainingTextualReferences: string[] = [];
  for (const file of documentationPathFiles(root)) {
    const source = readFileSync(file, "utf8");
    const output = replaceDocumentationPaths(root, source, mappings);
    if (output !== source) edits.set(file, output);
    remainingTextualReferences.push(
      ...documentationPathReferences(root, output, file, mappings),
    );
  }

  for (const mapping of mappings) {
    if (!existsSync(mapping.from) || !mapping.to) unresolved.push(mapping.from);
  }
  return { mappings, edits, collisions, unresolved, remainingTextualReferences };
}

export function applyFilenameMigration(plan: FilenameMigrationPlan): void {
  if (
    plan.collisions.length ||
    plan.unresolved.length ||
    plan.remainingTextualReferences.length
  ) {
    throw new Error(
      "Cannot apply filename migration with collisions or unresolved mappings.",
    );
  }
  const moves = [...plan.mappings].sort(
    (left, right) => right.from.length - left.from.length,
  );
  for (const mapping of moves) renameSync(mapping.from, mapping.to);
  for (const [file, source] of plan.edits) {
    const target = plan.mappings.find((mapping) => mapping.from === file)?.to ?? file;
    writeFileSync(target, source, "utf8");
  }
}
