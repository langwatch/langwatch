import { join, relative } from "node:path";

import ts from "typescript";

import type {
  ArchitectureViolation,
  ClassifiedPackage,
  FeatureCatalogueEntry,
} from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * A process `*.service.ts` using four or more operations of one peer's `*Api` does that peer's work
 * (ARCHITECTURE.md §17, rule 13d); `*.app.ts` roots are out of scope. Shrink-only. Operations are
 * the names a Pick of the Api takes plus members called on a holder typed with it, counted once.
 */

const POLICY = "peer-api-fan-in";
export const PEER_API_FAN_IN_THRESHOLD = 4;
const SERVICE_FILE = /\/process\/src\/.*\.service\.ts$/;
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const API_NAME = /^[A-Z]\w*Api$/;
const ALLOWED =
  "Ask the peer for one operation that does the work, add it to the peer's Api, and let the peer own the steps; or move this service into the peer. See dev/docs/ARCHITECTURE.md §5 and §17.";

/** One service's operations of one peer module's Api. */
export type PeerApiFanIn = {
  module: string;
  file: string;
  line: number;
  peer: string;
  api: string;
  operations: readonly string[];
};

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Local name of each `*Api` the file imports from another module's contract, to its peer. */
function peerApiImports({
  source,
  module,
  contracts,
}: {
  source: ts.SourceFile;
  module: string;
  contracts: ReadonlyMap<string, string>;
}): Map<string, { api: string; peer: string }> {
  const found = new Map<string, { api: string; peer: string }>();

  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const specifier = statement.moduleSpecifier.text;
    const packageName = specifier.split("/").slice(0, 2).join("/");
    const peer = contracts.get(packageName);
    if (!peer || peer === module) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      const api = (element.propertyName ?? element.name).text;
      if (API_NAME.test(api)) found.set(element.name.text, { api, peer });
    }
  }

  return found;
}

function typeReferenceName(node: ts.TypeNode | undefined): string | undefined {
  if (!node || !ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return void 0;

  return node.typeName.text;
}

function literalTexts(node: ts.TypeNode | undefined): string[] {
  if (!node) return [];
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text];

  return ts.isUnionTypeNode(node) ? node.types.flatMap(literalTexts) : [];
}

/** The peer Api a type names, whole or through `Pick<PeerApi, ...>`. */
function apiOfType({
  type,
  apis,
}: {
  type: ts.TypeNode | undefined;
  apis: ReadonlyMap<string, unknown>;
}): string | undefined {
  const name = typeReferenceName(type);
  if (name && apis.has(name)) return name;

  if (name !== "Pick" || !type || !ts.isTypeReferenceNode(type)) return void 0;

  const picked = typeReferenceName(type.typeArguments?.[0]);

  return picked && apis.has(picked) ? picked : void 0;
}

function holderOf(node: ts.Node): { name: string; type: ts.TypeNode | undefined } | undefined {
  const holds =
    ts.isPropertyDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node);
  if (!holds) return void 0;

  const name = node.name;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name))
    return { name: name.text, type: node.type };

  return void 0;
}

function calledMember(node: ts.Node): { holder: string; operation: string } | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return void 0;

  const holder = node.expression.expression;
  const operation = node.expression.name.text;

  if (ts.isIdentifier(holder)) return { holder: holder.text, operation };
  if (ts.isPropertyAccessExpression(holder)) return { holder: holder.name.text, operation };

  return void 0;
}

/** Each peer Api's operations taken so far, and the line it is first taken on. */
type FanInTally = {
  source: ts.SourceFile;
  operations: Map<string, Set<string>>;
  firstLine: Map<string, number>;
};

type HeldApis = Map<string, Set<string>>;
type MemberCall = { holder: string; operation: string };

function take({
  tally,
  api,
  names,
  node,
}: {
  tally: FanInTally;
  api: string;
  names: readonly string[];
  node: ts.Node;
}): void {
  const known = tally.operations.get(api) ?? new Set<string>();
  for (const name of names) known.add(name);
  tally.operations.set(api, known);
  if (!tally.firstLine.has(api)) tally.firstLine.set(api, lineOf(tally.source, node));
}

/** Tallies each `Pick` of a peer Api and each Api-typed holder; returns holders and calls. */
function scanPicksAndHolders({
  tally,
  apis,
}: {
  tally: FanInTally;
  apis: ReadonlyMap<string, { api: string; peer: string }>;
}): { holders: HeldApis; calls: MemberCall[] } {
  const holders: HeldApis = new Map();
  const calls: MemberCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && typeReferenceName(node) === "Pick") {
      const picked = typeReferenceName(node.typeArguments?.[0]);
      const names = literalTexts(node.typeArguments?.[1]);
      if (picked && apis.has(picked)) take({ tally, api: picked, names, node });
    }

    const holder = holderOf(node);
    const api = holder ? apiOfType({ type: holder.type, apis }) : void 0;
    if (holder && api) {
      holders.set(holder.name, (holders.get(holder.name) ?? new Set()).add(api));
      take({ tally, api, names: [], node });
    }

    const call = calledMember(node);
    if (call) calls.push(call);

    ts.forEachChild(node, visit);
  };
  visit(tally.source);

  return { holders, calls };
}

/** Tallies each member call on a holder of exactly one peer Api that the Api declares. */
function tallyMemberCalls({
  tally,
  apis,
  shapes,
  holders,
  calls,
}: {
  tally: FanInTally;
  apis: ReadonlyMap<string, { api: string; peer: string }>;
  shapes: ReadonlyMap<string, TypeShape>;
  holders: HeldApis;
  calls: readonly MemberCall[];
}): void {
  for (const call of calls) {
    const held = holders.get(call.holder);
    // A name two peer Apis travel under says nothing about which one is called.
    const only = held?.size === 1 ? [...held][0] : void 0;
    const api = only ? apis.get(only)?.api : void 0;
    // Only the Api's own operations count: `projects.map(...)` on a local array of the same
    // name is not a call on ProjectApi. An Api whose shape cannot be read counts no call.
    const operations = api ? apiOperations({ api, shapes }) : void 0;
    if (only && operations?.has(call.operation))
      take({ tally, api: only, names: [call.operation], node: tally.source });
  }
}

function fileFanIn({
  file,
  module,
  contracts,
  shapes,
}: {
  file: string;
  module: string;
  contracts: ReadonlyMap<string, string>;
  shapes: ReadonlyMap<string, TypeShape>;
}): PeerApiFanIn[] {
  const source = sourceFile({ file });
  const apis = peerApiImports({ source, module, contracts });
  if (apis.size === 0) return [];

  const tally: FanInTally = { source, operations: new Map(), firstLine: new Map() };
  const { holders, calls } = scanPicksAndHolders({ tally, apis });
  tallyMemberCalls({ tally, apis, shapes, holders, calls });
  const { operations, firstLine } = tally;

  return [...operations]
    .filter(([, names]) => names.size >= PEER_API_FAN_IN_THRESHOLD)
    .map(([local, names]) => {
      const imported = apis.get(local);

      return {
        module,
        file,
        line: firstLine.get(local) ?? 1,
        peer: imported?.peer ?? "",
        api: imported?.api ?? local,
        operations: [...names].toSorted(),
      };
    });
}

type TypeShape = { members: Set<string>; bases: string[]; open: boolean };

function memberNames(members: ts.NodeArray<ts.TypeElement>): string[] {
  return members.flatMap((member) =>
    member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
      ? [member.name.text]
      : [],
  );
}

/** A type alias's members: an object literal, `Readonly<{...}>`, or an intersection of those. */
function aliasShape(node: ts.TypeNode): TypeShape {
  if (ts.isTypeLiteralNode(node))
    return { members: new Set(memberNames(node.members)), bases: [], open: false };

  if (ts.isIntersectionTypeNode(node)) {
    const parts = node.types.map(aliasShape);

    return {
      members: new Set(parts.flatMap((part) => [...part.members])),
      bases: parts.flatMap((part) => part.bases),
      open: parts.some((part) => part.open),
    };
  }

  const name = typeReferenceName(node);
  const typeArguments = ts.isTypeReferenceNode(node) ? node.typeArguments : undefined;
  const [first] = typeArguments ?? [];
  if (name === "Readonly" && first) return aliasShape(first);
  if (name && !typeArguments) return { members: new Set(), bases: [name], open: false };

  return { members: new Set(), bases: [], open: true };
}

/** Every interface and type alias the contract packages declare, by name. */
function contractShapes(packages: readonly ClassifiedPackage[]): Map<string, TypeShape> {
  const shapes = new Map<string, TypeShape>();
  const contracts = packages.filter((item) => item.kind === "contract");

  for (const file of contracts.flatMap((item) =>
    listFiles({
      directory: join(item.root, "src"),
      accept: (path) => /\.tsx?$/.test(path) && !TEST_FILE.test(path),
    }),
  )) {
    for (const statement of sourceFile({ file }).statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        const bases = (statement.heritageClauses ?? []).flatMap((clause) =>
          clause.types.flatMap((type) =>
            ts.isIdentifier(type.expression) ? [type.expression.text] : [],
          ),
        );
        shapes.set(statement.name.text, {
          members: new Set(memberNames(statement.members)),
          bases,
          open: false,
        });
      } else if (ts.isTypeAliasDeclaration(statement)) {
        shapes.set(statement.name.text, aliasShape(statement.type));
      }
    }
  }

  return shapes;
}

/** An Api's operation names through its bases, or undefined when a base cannot be read. */
export function apiOperations({
  api,
  shapes,
  seen = new Set(),
}: {
  api: string;
  shapes: ReadonlyMap<string, TypeShape>;
  seen?: Set<string>;
}): Set<string> | undefined {
  const shape = shapes.get(api);
  if (!shape || shape.open || seen.has(api)) return void 0;

  seen.add(api);
  const members = new Set(shape.members);
  for (const base of shape.bases) {
    const inherited = apiOperations({ api: base, shapes, seen });
    if (!inherited) return void 0;
    for (const name of inherited) members.add(name);
  }

  return members;
}

/** Contract package name to its module, for every module's contract package. */
function contractPackages(packages: readonly ClassifiedPackage[]): Map<string, string> {
  return new Map(
    packages.flatMap((item) =>
      item.kind === "contract" && item.feature ? [[item.name, item.feature] as const] : [],
    ),
  );
}

/** Every process service that takes four or more operations of one peer's Api. */
export function collectPeerApiFanIn({
  root,
  catalogue,
  packages,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  packages: readonly ClassifiedPackage[];
}): PeerApiFanIn[] {
  const contracts = contractPackages(packages);
  const shapes = contractShapes(packages);

  return catalogue.flatMap((feature) =>
    listFiles({
      directory: join(root, feature.root),
      accept: (file) => SERVICE_FILE.test(file) && !TEST_FILE.test(file),
    })
      .filter((file) => /\b[A-Z]\w*Api\b/.test(sourceText({ file })))
      .toSorted()
      .flatMap((file) => fileFanIn({ file, module: feature.id, contracts, shapes })),
  );
}

/** The shrink-only list's keys: `<file>|<PeerApi>`, once per operation taken. */
export function peerApiFanInKeys({
  root,
  found,
}: {
  root: string;
  found: readonly PeerApiFanIn[];
}): string[] {
  return found.flatMap((item) =>
    item.operations.map(() => `${relative(root, item.file)}|${item.api}`),
  );
}

export function lintPeerApiFanIn(
  snapshot: Pick<WorkspaceSnapshot, "root" | "catalogue" | "packages">,
): ArchitectureViolation[] {
  return collectPeerApiFanIn(snapshot).map((item) => ({
    policy: POLICY,
    file: item.file,
    line: item.line,
    message: `${item.module} takes ${item.operations.length} operations of ${item.peer}'s ${item.api} (${item.operations.join(", ")}): ${PEER_API_FAN_IN_THRESHOLD} or more means it is doing ${item.peer}'s work.`,
    allowed: ALLOWED,
  }));
}
