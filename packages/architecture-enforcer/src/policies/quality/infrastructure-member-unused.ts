import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../../baseline.ts";
import { walkFiles } from "../../workspace/layout.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../../types.ts";

/**
 * A member of the `<Feature>Infrastructure` interface beside a module's App
 * that no app, service or repository in the owning package reaches: a boot
 * requirement every process pays for and nothing uses. README, "The dead-code
 * guards"; ADR-137.
 */

const BASELINE_FILE = "infrastructure-member-unused-baseline.json";

/** Where a module's server package lives, core and enterprise. */
const MODULE_GROUPS = ["modules", join("enterprise", "modules")];

/** The interface the process supplies, by the name the grammar gives it. */
const INFRASTRUCTURE = /Infrastructure$/;

const SKIPPED_DIRECTORIES = new Set(["__tests__", "__mocks__", "generated", "testing"]);

export type InfrastructureMemberFinding = {
  /** Repository-relative path of the file declaring the interface. */
  path: string;
  /** The declaring package's directory, repository-relative. */
  packagePath: string;
  /** The interface the process supplies. */
  interfaceName: string;
  /** The member nothing in the package reaches. */
  member: string;
  message: string;
  allowed: string;
};

/** Code-unit order, the order every baseline in this package is written in. */
function byKey(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function isSourceFile(path: string): boolean {
  const name = basename(path);
  if (!/\.tsx?$/.test(name)) return false;

  if (name.endsWith(".d.ts")) return false;

  return !/\.generated\.tsx?$/.test(name);
}

function isTestModule(path: string): boolean {
  const name = basename(path);
  if (/\.(?:test|spec)\.tsx?$/.test(name)) return true;

  const isTestingEntry = name === "testing.ts" || name.endsWith(".testing.ts");
  if (isTestingEntry) return true;

  return path.split(sep).some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/** Every module server package's source directory, core and enterprise. */
export function moduleServerRoots(root: string): string[] {
  const manifests = MODULE_GROUPS.flatMap((group) =>
    walkFiles(join(root, group), (path) => basename(path) === "package.json"),
  );

  const roots = manifests.filter((file) => {
    const parts = relative(root, file).split(sep);
    const server = parts.indexOf("server");

    return server > 0 && parts.length === server + 2;
  });

  return roots.map((file) => join(file, "..", "src")).sort();
}

/**
 * The tree moves under a walk: a codemod deletes a file between the listing
 * and the parse, and a file that has gone is not in the tree any more.
 */
function statementsOf(file: string): readonly ts.Statement[] {
  return existsSync(file) ? sourceFile({ file }).statements : [];
}

function memberNamesOf(members: ts.NodeArray<ts.TypeElement>): string[] {
  return members.flatMap((member) => {
    const named = ts.isPropertySignature(member) || ts.isMethodSignature(member);
    if (!named) return [];

    return ts.isIdentifier(member.name) ? [member.name.text] : [];
  });
}

type InfrastructureDeclaration = { file: string; interfaceName: string; members: string[] };

type DeclaredShape = { name: string; members: ts.NodeArray<ts.TypeElement> };

/** The infrastructure shape a statement declares, written either way the grammar allows. */
function declaredShape(statement: ts.Statement): DeclaredShape | undefined {
  if (ts.isInterfaceDeclaration(statement)) {
    if (!INFRASTRUCTURE.test(statement.name.text)) return void 0;

    return { name: statement.name.text, members: statement.members };
  }

  if (!ts.isTypeAliasDeclaration(statement)) return void 0;

  if (!INFRASTRUCTURE.test(statement.name.text)) return void 0;

  if (!ts.isTypeLiteralNode(statement.type)) return void 0;

  return { name: statement.name.text, members: statement.type.members };
}

function declarationsIn(files: readonly string[]): InfrastructureDeclaration[] {
  return files.flatMap((file) =>
    statementsOf(file).flatMap((statement) => {
      const shape = declaredShape(statement);
      if (shape === void 0) return [];

      return [{ file, interfaceName: shape.name, members: memberNamesOf(shape.members) }];
    }),
  );
}

/** The name a node reaches through a value, by access or by destructuring. */
function reachedName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.name) ? node.name.text : void 0;
  }

  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;

    return ts.isStringLiteralLike(argument) ? argument.text : void 0;
  }

  if (!ts.isBindingElement(node)) return void 0;

  const source = node.propertyName ?? node.name;

  return ts.isIdentifier(source) ? source.text : void 0;
}

/** Every name this file reaches through a value. */
function readNames(file: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(file)) return names;

  const visit = (node: ts.Node): void => {
    const name = reachedName(node);
    if (name !== void 0) names.add(name);

    ts.forEachChild(node, visit);
  };

  visit(sourceFile({ file }));

  return names;
}

function finding({
  declaration,
  member,
  packagePath,
  path,
}: {
  declaration: InfrastructureDeclaration;
  member: string;
  packagePath: string;
  path: string;
}): InfrastructureMemberFinding {
  return {
    path,
    packagePath,
    interfaceName: declaration.interfaceName,
    member,
    message:
      `\`${declaration.interfaceName}\` declares \`${member}\`, and no app, service or ` +
      "repository in this package ever reaches it. Every process that boots the module has to " +
      "build and pass it anyway, and the next reader has to work out what depends on it.",
    allowed:
      "Delete the member and the collaborator each composition root builds for it. If something " +
      "outside the package needs the value, it belongs on that side, not on this module's boot " +
      "requirements.",
  };
}

/** The key of an infrastructure-member row. */
function entryKey(entry: { packagePath: string; interfaceName: string; member: string }): string {
  return `${entry.packagePath}|${entry.interfaceName}|${entry.member}`;
}

/**
 * Read once per package, the declaring file included: an interface member is a
 * signature, never an access, and most modules declare the shape inside the very
 * app that reads it.
 */
function packageFindings({
  root,
  src,
}: {
  root: string;
  src: string;
}): InfrastructureMemberFinding[] {
  const files = walkFiles(src, (path) => {
    if (!isSourceFile(path)) return false;

    return !isTestModule(path);
  });

  const declarations = declarationsIn(files);
  if (declarations.length === 0) return [];

  const read = new Set(files.flatMap((file) => [...readNames(file)]));
  const packagePath = relative(root, join(src, ".."));

  return declarations.flatMap((declaration) =>
    declaration.members
      .filter((member) => !read.has(member))
      .map((member) =>
        finding({ declaration, member, packagePath, path: relative(root, declaration.file) }),
      ),
  );
}

export function collectInfrastructureMemberFindings(root: string): InfrastructureMemberFinding[] {
  const findings = moduleServerRoots(root).flatMap((src) => packageFindings({ root, src }));

  return findings.sort((left, right) => byKey(entryKey(left), entryKey(right)));
}

export const INFRASTRUCTURE_MEMBER_UNUSED_BASELINE: BaselinePolicy = {
  id: "infrastructure-member-unused",
  file: BASELINE_FILE,
  label: "Unused infrastructure member baseline",
  keyRule: "A key is `<package directory>|<interface>|<member>`.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Unused infrastructure member baseline entry ${entry.key.split("|").join(" ")} no longer matches anything and must be removed.`,
  }),
};

export function collectInfrastructureMemberBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectInfrastructureMemberFindings(root).map(entryKey);

  return collectBaseline({ policy: INFRASTRUCTURE_MEMBER_UNUSED_BASELINE, found, previous });
}

export function lintInfrastructureMembers(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const policy = INFRASTRUCTURE_MEMBER_UNUSED_BASELINE;
  const file = baselinePath({ root, policy });
  const baseline = readBaseline({ policy, file });

  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy, file }),
  ];

  const findings = collectInfrastructureMemberFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map(entryKey));

  const unlisted = findings.filter((one) => !baselined.has(entryKey(one)));

  violations.push(
    ...unlisted.map((one) => ({
      policy: "infrastructure-member-unused",
      file: join(root, one.path),
      message: one.message,
      allowed: one.allowed,
    })),
  );

  violations.push(...staleRows({ entries: baseline.entries, found, policy, file }));

  return violations;
}
