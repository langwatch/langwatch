import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { FEATURE_PREFIX } from "@langwatch/oxlint-rules/grammar/feature-layout-policy.mjs";
import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { getAnchor } from "../../workspace/anchors.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile as parsedSourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/** A named reader's write a ruling admits on a share, by file, with its reason (R42). */
export type SharedPrismaWrite = { reader: string; file: string; reason: string };

/** A Prisma model its claiming module shares for reading with named modules (R40). */
export type SharedPrismaTable = {
  table: string;
  owner: string;
  readers: readonly string[];
  reason: string;
  writes?: readonly SharedPrismaWrite[];
};

/** The Postgres twin of clickhouse-table-ownership's `shared`; `table` is the model name. */
export const SHARED_PRISMA_TABLES: readonly SharedPrismaTable[] = [
  {
    table: "Project",
    owner: "project",
    readers: [
      "entitlement",
      "billing",
      "data-retention",
      "data-privacy",
      "instant-eval-judge",
      "nurturing",
    ],
    reason:
      "entitlement reads a project's organisation and an organisation's projects, never a fold (C1, R40); billing reads an organisation's project ids and names for spend and usage warnings (round 37 D5, R40); data retention and data privacy read where a project sits to resolve its policy, never a fold (round 46 E1, R40); the Instant Evals judge and nurturing read a project's team to place it, and nurturing an organisation's earliest project creation for its cutover (DATA-NURTURING-GUARD), never a fold (round 46 E1, R40)",
  },
  {
    table: "Team",
    owner: "organization",
    readers: ["data-retention", "data-privacy", "instant-eval-judge", "nurturing"],
    reason:
      "data retention and data privacy read a team's organisation to place a project or a team-level rule, never a fold (round 46 E1, R40); the Instant Evals judge and nurturing read a project's organisation through its team and an organisation's teams for its earliest project (round 46 E1, R40)",
  },
  {
    table: "OrganizationUser",
    owner: "organization",
    readers: ["authz", "data-privacy"],
    reason:
      "authz reads memberships for every decision and answers its active administrators from them (R41, R42); data privacy reads a personal project owner's department from the membership, as main did (round 53)",
    writes: [
      {
        reader: "authz",
        file: "modules/authz/process/src/repositories/prisma/prisma.authz-admission.repository.ts",
        reason:
          "SSO admission completes or clears pendingSsoGrantId atomically with the grant (R42)",
      },
      {
        reader: "authz",
        file: "modules/authz/process/src/repositories/prisma/prisma.authz-ledger-read.repository.ts",
        reason:
          "offboarding deletes the membership first, its lock serialising the grant snapshot (R42)",
      },
    ],
  },
  {
    table: "Organization",
    owner: "organization",
    readers: ["scim", "entitlement", "billing"],
    reason:
      "scim resolves an organisation by its SSO domain and reads names for its oversight screen (R37 S1 R2, R40, R42); entitlement reads the currency and dataset limit it prices and bounds by (C1, R40); billing reads the name, Stripe customer, pricing model and licence it bills by, its other writes being facts organization applies (R42, round 46 D-b)",
    writes: [
      {
        reader: "billing",
        file: "enterprise/modules/billing/process/src/repositories/prisma/prisma.billing-account-facts.repository.ts",
        reason:
          "the Stripe customer-id claim stays a synchronous compare-and-set, so two checkouts never make two customers (round 46 D-b)",
      },
    ],
  },
  {
    table: "Topic",
    owner: "topic",
    readers: ["trace"],
    reason: "trace labels topic facets with topic's names, keeping no copy (R40)",
  },
  {
    table: "Annotation",
    owner: "annotation",
    readers: ["trace"],
    reason: "trace's legacy read attaches a page's annotations, keeping no copy (R40)",
  },
  {
    table: "AnnotationScore",
    owner: "annotation",
    readers: ["trace"],
    reason: "trace's legacy read names annotation scores, deleted definitions included (R40)",
  },
];

const PRISMA_REPOSITORY_FILE = new RegExp(
  `/process/src/${FEATURE_PREFIX}repositories/prisma/prisma\\.[^/]+\\.repository\\.ts$`,
);
const OWNERSHIP_MODULE = "@langwatch/prisma-client/ownership";
const REPOSITORY_MODULE = "@langwatch/prisma-client";
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SCHEMA_PATH = "packages/prisma-client/prisma/schema.prisma";

/**
 * The model names `schema.prisma` declares, mapped to their `@@map` table
 * name (or the model name itself). Shared with `prisma-migration-access.ts`,
 * which needs the same names to police who may reach them.
 */
export function prismaModelNames({
  root,
  policy,
}: {
  root: string;
  policy: string;
}): Map<string, string> {
  const schemaFile = getAnchor({ root, anchor: SCHEMA_PATH, policy });
  const models = new Map<string, string>();

  const schema = readFileSync(schemaFile, "utf8");

  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = match[1];
    if (name) models.set(name, /@@map\(\s*"([^"]+)"\s*\)/.exec(match[2] ?? "")?.[1] ?? name);
  }

  return models;
}

type Bindings = {
  named: Set<string>;
  namespaces: Set<string>;
  repositoryBases: Set<string>;
  repositoryNamespaces: Set<string>;
};
type ClaimCall = { call: ts.CallExpression; source: "tables" | "repository" };
export type Claim = { feature: string; file: string; model: string; line: number };

function issue(file: string, message: string, line?: number): ArchitectureViolation {
  return {
    policy: "prisma-table-ownership",
    file,
    line,
    message,
    allowed:
      "Declare literal model names with prismaTables(...) or PrismaRepository.for(...) on the owning Prisma repository. Peers call the owner's ModuleApi. See ADR-134.",
  };
}

function isClaimProperty(call: ts.CallExpression, file: string): boolean {
  const property = call.parent;
  if (!ts.isPropertyDeclaration(property)) return false;

  if (!ts.isClassDeclaration(property.parent)) return false;

  if (!ts.isIdentifier(property.name)) return false;

  if (property.name.text !== "tables") return false;

  const modifiers = ts.getModifiers(property) ?? [];

  return (
    modifiers.some((item) => item.kind === ts.SyntaxKind.StaticKeyword) &&
    modifiers.some((item) => item.kind === ts.SyntaxKind.ReadonlyKeyword) &&
    PRISMA_REPOSITORY_FILE.test(file)
  );
}

function importedBindings(source: ts.SourceFile): Bindings {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  const repositoryBases = new Set<string>();
  const repositoryNamespaces = new Set<string>();

  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const module = statement.moduleSpecifier.text;
    const imported = statement.importClause?.namedBindings;
    if (!imported) continue;

    if (module === REPOSITORY_MODULE) {
      addRepositoryBindings({ imported, repositoryBases, repositoryNamespaces });
    }

    if (module !== OWNERSHIP_MODULE) continue;

    addOwnershipBindings({ imported, named, namespaces });
  }

  return { named, namespaces, repositoryBases, repositoryNamespaces };
}

function addRepositoryBindings({
  imported,
  repositoryBases,
  repositoryNamespaces,
}: {
  imported: ts.NamedImportBindings;
  repositoryBases: Set<string>;
  repositoryNamespaces: Set<string>;
}): void {
  if (ts.isNamespaceImport(imported)) {
    repositoryNamespaces.add(imported.name.text);
    return;
  }

  for (const binding of imported.elements) {
    if ((binding.propertyName ?? binding.name).text === "PrismaRepository") {
      repositoryBases.add(binding.name.text);
    }
  }
}

function addOwnershipBindings({
  imported,
  named,
  namespaces,
}: {
  imported: ts.NamedImportBindings;
  named: Set<string>;
  namespaces: Set<string>;
}): void {
  if (ts.isNamespaceImport(imported)) {
    namespaces.add(imported.name.text);
    return;
  }

  for (const binding of imported.elements) {
    if ((binding.propertyName ?? binding.name).text === "prismaTables") {
      named.add(binding.name.text);
    }
  }
}

function isRepositoryBase(node: ts.Expression, bindings: Bindings): boolean {
  if (ts.isIdentifier(node)) return bindings.repositoryBases.has(node.text);

  if (!ts.isPropertyAccessExpression(node)) return false;

  if (!ts.isIdentifier(node.expression)) return false;

  return (
    bindings.repositoryNamespaces.has(node.expression.text) && node.name.text === "PrismaRepository"
  );
}

function nativeRepositoryCall(node: ts.Node, bindings: Bindings): ts.CallExpression | undefined {
  if (!ts.isCallExpression(node)) return void 0;

  if (!ts.isPropertyAccessExpression(node.expression)) return void 0;

  const factory = node.expression;
  const isNativeFactory = ["for", "transactionalFor"].includes(factory.name.text);

  return isNativeFactory && isRepositoryBase(factory.expression, bindings) ? node : void 0;
}

function isNativeClaimHeritage(call: ts.CallExpression, file: string): boolean {
  const heritage = call.parent;

  if (!ts.isExpressionWithTypeArguments(heritage) || heritage.expression !== call) return false;

  if (
    !ts.isHeritageClause(heritage.parent) ||
    heritage.parent.token !== ts.SyntaxKind.ExtendsKeyword
  )
    return false;

  if (!ts.isClassDeclaration(heritage.parent.parent)) return false;

  return PRISMA_REPOSITORY_FILE.test(file);
}

function isFactoryReference(node: ts.Node, bindings: Bindings): boolean {
  if (ts.isIdentifier(node)) {
    return bindings.named.has(node.text) && !ts.isImportSpecifier(node.parent);
  }

  if (!ts.isPropertyAccessExpression(node)) return false;

  if (!ts.isIdentifier(node.expression)) return false;

  return bindings.namespaces.has(node.expression.text) && node.name.text === "prismaTables";
}

function rejectsNamespaceForward(node: ts.Node, bindings: Bindings): boolean {
  if (!ts.isIdentifier(node)) return false;

  if (!bindings.namespaces.has(node.text)) return false;

  if (ts.isNamespaceImport(node.parent)) return false;

  const parent = node.parent;
  const directProperty = ts.isPropertyAccessExpression(parent) && parent.expression === node;

  return !directProperty || parent.name.text !== "prismaTables";
}

function lintFactoryExports(source: ts.SourceFile): ArchitectureViolation[] {
  return source.statements.filter(ts.isExportDeclaration).flatMap((statement) => {
    const module = statement.moduleSpecifier;
    if (!module || !ts.isStringLiteral(module)) return [];

    if (statement.isTypeOnly || module.text !== OWNERSHIP_MODULE) return [];

    return [
      issue(
        source.fileName,
        "Do not re-export the Prisma ownership module; repositories import prismaTables directly.",
      ),
    ];
  });
}

function claimCalls(source: ts.SourceFile, violations: ArchitectureViolation[]): ClaimCall[] {
  const calls: ClaimCall[] = [];
  const bindings = importedBindings(source);
  violations.push(...lintFactoryExports(source));

  const visit = (node: ts.Node): void => {
    if (rejectsNamespaceForward(node, bindings)) {
      violations.push(
        issue(
          source.fileName,
          "Do not forward or use computed access on the Prisma ownership namespace.",
        ),
      );
    }

    if (isFactoryReference(node, bindings)) {
      const parent = node.parent;
      const directCall = ts.isCallExpression(parent) && parent.expression === node;

      if (directCall) {
        calls.push({ call: parent, source: "tables" });
      } else {
        violations.push(
          issue(
            source.fileName,
            "Do not alias or forward prismaTables; keep the repository claim directly inspectable.",
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

function nativeRepositoryClaims(
  source: ts.SourceFile,
  violations: ArchitectureViolation[],
): ClaimCall[] {
  const calls: ClaimCall[] = [];
  const bindings = importedBindings(source);

  const visit = (node: ts.Node): void => {
    const call = nativeRepositoryCall(node, bindings);

    if (call) {
      if (!isNativeClaimHeritage(call, source.fileName)) {
        const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;

        violations.push(
          issue(
            source.fileName,
            "PrismaRepository model declaration must directly extend an owning Prisma repository.",
            line,
          ),
        );
      }

      calls.push({ call, source: "repository" });
    }

    if (ts.isExpressionWithTypeArguments(node) && isRepositoryBase(node.expression, bindings)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      violations.push(
        issue(
          source.fileName,
          "PrismaRepository must declare owned models through .for(...) or .transactionalFor(...).",
          line,
        ),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

function readClaim({
  claim,
  source,
  feature,
  violations,
}: {
  claim: ClaimCall;
  source: ts.SourceFile;
  feature: string;
  violations: ArchitectureViolation[];
}): Claim[] {
  const { call } = claim;
  const file = source.fileName;
  const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;

  const validLocation =
    claim.source === "tables" ? isClaimProperty(call, file) : isNativeClaimHeritage(call, file);

  if (!validLocation) {
    violations.push(
      issue(file, "Prisma table claims belong to a static readonly repository declaration.", line),
    );
  }

  const computed = call.arguments.some((argument) => !ts.isStringLiteral(argument));

  if (call.arguments.length === 0 || computed) {
    violations.push(
      issue(
        file,
        "A Prisma claim needs at least one literal model name; spreads and computed claims hide ownership.",
        line,
      ),
    );

    return [];
  }

  return call.arguments
    .filter(ts.isStringLiteral)
    .map((argument) => ({ feature, file, model: argument.text, line }));
}

export function featureClaims(
  root: string,
  feature: FeatureCatalogueEntry,
  violations: ArchitectureViolation[],
): Claim[] {
  const files = listFiles({
    directory: join(root, feature.root),
    accept: (file) => /\.[cm]?tsx?$/.test(file) && !TEST_FILE.test(file),
  });

  return files.flatMap((file) => {
    const text = sourceText({ file });
    if (!text.includes(OWNERSHIP_MODULE) && !text.includes(REPOSITORY_MODULE)) return [];

    const source = parsedSourceFile({ file });

    return [
      ...claimCalls(source, violations),
      ...nativeRepositoryClaims(source, violations),
    ].flatMap((claim) => readClaim({ claim, source, feature: feature.id, violations }));
  });
}

/** A claim by a module the model's owner named as a reader: a read seat, not a second owner. */
function isReaderClaim(claim: Claim, shared: readonly SharedPrismaTable[]): boolean {
  return shared.some((item) => item.table === claim.model && item.readers.includes(claim.feature));
}

function checkOwners({
  claims,
  models,
  shared,
}: {
  claims: readonly Claim[];
  models: ReadonlyMap<string, string>;
  shared: readonly SharedPrismaTable[];
}): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const owners = new Map<string, Claim>();

  for (const claim of claims) {
    const table = models.get(claim.model);

    if (!table) {
      violations.push(issue(claim.file, `Unknown Prisma model ${claim.model}.`, claim.line));
      continue;
    }

    if (isReaderClaim(claim, shared)) continue;

    const previous = owners.get(table);

    if (previous && previous.feature !== claim.feature) {
      violations.push(
        issue(
          claim.file,
          `Table ${table} is claimed by ${claim.feature} and ${previous.feature} (${previous.file}). Keep a single module owner.`,
          claim.line,
        ),
      );
    } else {
      owners.set(table, claim);
    }
  }

  return violations;
}

/**
 * Checks adoption across the catalogue, features never installed together included. Declared
 * shares apply where their owner is catalogued; migration access is its own policy (index.ts).
 */
export function lintPrismaTableOwnership(
  snapshot: WorkspaceSnapshot,
  declared?: readonly SharedPrismaTable[],
): ArchitectureViolation[] {
  const { root, catalogue } = snapshot;
  const shared =
    declared ??
    SHARED_PRISMA_TABLES.filter((item) => catalogue.some((entry) => entry.id === item.owner));
  const models = prismaModelNames({ root, policy: "prisma-table-ownership" });
  const violations: ArchitectureViolation[] = [];
  const claims = catalogue.flatMap((feature) => featureClaims(root, feature, violations));

  return [
    ...violations,
    ...checkOwners({ claims, models, shared }),
    ...sharedFindings({ root, catalogue, claims, models, shared }),
  ];
}

const READ_METHODS = new Set([
  "aggregate",
  "count",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
]);
const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const SQL_VERB = "(FROM|JOIN|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)";
const READING_VERBS = new Set(["from", "join"]);

/** One read or write of a shared model by a named reader: a delegate call or quoted raw SQL. */
type ShareAccess = { file: string; line: number; write: boolean };

/** A delegate method call on the model, as eventing-table-access.ts reads delegates. */
function delegateAccess(node: ts.Node, delegate: string): boolean | undefined {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== delegate) return void 0;

  const method = node.parent;
  if (!ts.isPropertyAccessExpression(method) || method.expression !== node) return void 0;

  if (!ts.isCallExpression(method.parent) || method.parent.expression !== method) return void 0;

  if (WRITE_METHODS.has(method.name.text)) return true;

  return READ_METHODS.has(method.name.text) ? false : void 0;
}

function fileAccess({
  file,
  table,
  delegate,
}: {
  file: string;
  table: string;
  delegate: string;
}): ShareAccess[] {
  const text = sourceText({ file });
  if (!text.includes(delegate) && !text.includes(`"${table}"`)) return [];

  const source = parsedSourceFile({ file });
  const sql = new RegExp(`\\b${SQL_VERB}\\s+"${table}"`, "gi");
  const found: ShareAccess[] = [];
  const add = (node: ts.Node, write: boolean): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    found.push({ file, line, write });
  };
  const visit = (node: ts.Node): void => {
    const write = delegateAccess(node, delegate);
    if (write !== void 0) add(node, write);

    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      for (const match of node.getText(source).matchAll(sql))
        add(node, !READING_VERBS.has((match[1] ?? "").toLowerCase()));
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

function readerAccess({
  root,
  feature,
  table,
}: {
  root: string;
  feature: FeatureCatalogueEntry;
  table: string;
}): ShareAccess[] {
  const delegate = `${table.charAt(0).toLowerCase()}${table.slice(1)}`;
  const files = listFiles({
    directory: join(root, feature.root),
    accept: (file) => /\.[cm]?tsx?$/.test(file) && !TEST_FILE.test(file),
  });

  return [...files].toSorted().flatMap((file) => fileAccess({ file, table, delegate }));
}

/** A wrong owner, an unadmitted write by a reader, a stale write exception or a stale reader. */
function sharedFindings({
  root,
  catalogue,
  claims,
  models,
  shared,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  claims: readonly Claim[];
  models: ReadonlyMap<string, string>;
  shared: readonly SharedPrismaTable[];
}): ArchitectureViolation[] {
  return shared.flatMap((item): ArchitectureViolation[] => {
    const physical = models.get(item.table);
    const owner = claims.find(
      (claim) => models.get(claim.model) === physical && !isReaderClaim(claim, shared),
    );

    if (!physical || owner?.feature !== item.owner) {
      return [
        issue(
          join(root, SCHEMA_PATH),
          `Table ${item.table} is declared shared by ${item.owner}, which does not own it. Fix or delete the declaration.`,
        ),
      ];
    }

    const written: SharedPrismaWrite[] = [];
    const readers = item.readers.flatMap((reader) => {
      const feature = catalogue.find((entry) => entry.id === reader);
      const access = feature ? readerAccess({ root, feature, table: item.table }) : [];
      const writes = access
        .filter((entry) => entry.write)
        .filter((entry) => {
          const excepted = admittedWrite({ item, reader, file: relative(root, entry.file) });
          if (excepted) written.push(excepted);

          return !excepted;
        })
        .map((entry) =>
          issue(
            entry.file,
            `${reader} writes ${item.table}, which ${item.owner} shares with it for reading only.`,
            entry.line,
          ),
        );

      if (access.some((entry) => !entry.write)) return writes;

      return [
        ...writes,
        issue(
          owner.file,
          `Table ${item.table} is shared with ${reader}, which no longer reads it. Delete the reader.`,
          owner.line,
        ),
      ];
    });

    return [...readers, ...staleWrites({ root, item, written })];
  });
}

function admittedWrite({
  item,
  reader,
  file,
}: {
  item: SharedPrismaTable;
  reader: string;
  file: string;
}): SharedPrismaWrite | undefined {
  return item.writes?.find((write) => write.reader === reader && write.file === file);
}

/** A write exception the tree no longer needs is deleted, so the share cannot widen silently. */
function staleWrites({
  root,
  item,
  written,
}: {
  root: string;
  item: SharedPrismaTable;
  written: readonly SharedPrismaWrite[];
}): ArchitectureViolation[] {
  return (item.writes ?? [])
    .filter((write) => !written.includes(write))
    .map((write) =>
      issue(
        join(root, write.file),
        `The write exception for ${write.reader} writing ${item.table} in ${write.file} matches no write. Delete it.`,
      ),
    );
}
