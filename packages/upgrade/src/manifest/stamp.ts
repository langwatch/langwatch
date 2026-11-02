import { compareReleases, type ManifestStep, type ReleaseManifest } from "./manifest.ts";

/** What one tree (working tree or release tag) holds: SQL file names and declared code steps. */
export interface ReleaseTreeSteps {
  prismaFolders: readonly string[];
  gooseFiles: readonly string[];
  codeSteps: readonly ManifestStep[];
}

/** Supplies the declared code steps the tasks container prints, until `mig-declare` lands. */
export interface DeclaredStepSource {
  list(): Promise<ManifestStep[]>;
}

const GOOSE_FILE = /^(\d+)_(.+)\.sql$/;
const PRISMA_FOLDER = /^\d{14}_(.+)$/;

export function prismaStepId({ folder }: { folder: string }): string {
  return `prisma:${folder}`;
}

/** goose's version is the file's numeric prefix; its id is padded to five digits. */
export function gooseStepId({ file }: { file: string }): string | null {
  const match = GOOSE_FILE.exec(file);
  return match?.[1] ? `clickhouse:${match[1].padStart(5, "0")}` : null;
}

/** Every step id a tree holds: the set a later release must not stamp again. */
export function treeStepIds({ tree }: { tree: ReleaseTreeSteps }): Set<string> {
  return new Set([
    ...tree.prismaFolders.map((folder) => prismaStepId({ folder })),
    ...tree.gooseFiles.flatMap((file) => gooseStepId({ file }) ?? []),
    ...tree.codeSteps.map((step) => step.id),
  ]);
}

function words(name: string): string {
  return name.replaceAll("_", " ").trim();
}

/**
 * The release's manifest: every step of `current` that `shipped` (the previous tag's tree and
 * every earlier manifest) lacks, Prisma folders by name, goose versions ascending, then code steps
 * in the order the tasks container declared them (rethink 6.3).
 */
export function stampRelease({
  release,
  previous,
  cutAt,
  current,
  shipped,
  ownerOf,
}: {
  release: string;
  previous: string | null;
  cutAt: string;
  current: ReleaseTreeSteps;
  shipped: ReadonlySet<string>;
  ownerOf: ({ id }: { id: string }) => string | null;
}): ReleaseManifest {
  const prisma = current.prismaFolders
    .filter((folder) => !shipped.has(prismaStepId({ folder })))
    .toSorted()
    .map((folder): ManifestStep => {
      const id = prismaStepId({ folder });
      const name = PRISMA_FOLDER.exec(folder)?.[1] ?? folder;
      return {
        id,
        kind: "postgres-schema",
        mode: "blocking",
        owner: ownerOf({ id }),
        description: `Postgres schema: ${words(name)}`,
      };
    });
  const goose = current.gooseFiles
    .flatMap((file) => {
      const id = gooseStepId({ file });
      return id && !shipped.has(id) ? [{ id, name: GOOSE_FILE.exec(file)?.[2] ?? file }] : [];
    })
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map(({ id, name }): ManifestStep => ({
      id,
      kind: "clickhouse-schema",
      mode: "blocking",
      owner: ownerOf({ id }),
      description: `ClickHouse schema: ${words(name)}`,
    }));
  const code = current.codeSteps.filter((step) => !shipped.has(step.id));
  return { release, previous, cutAt, steps: [...prisma, ...goose, ...code] };
}

const QUALIFIER = /^(?:"[^"]+"|`[^`]+`|\$\{[^}]*\}|\w+)\./;
const TOUCH = new RegExp(
  [
    String.raw`\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?(?:\s+ONLY)?`,
    String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*?\bON(?:\s+ONLY)?`,
    String.raw`\bINSERT\s+INTO`,
    String.raw`(?<!\b(?:ON|DO)\s+)\bUPDATE`,
    String.raw`\bDELETE\s+FROM`,
  ]
    .map(
      (verb) =>
        `${verb}\\s+((?:(?:"[^"]+"|\`[^\`]+\`|\\$\\{[^}]*\\}|\\w+)\\.)?(?:"[^"]+"|\`[^\`]+\`|\\w+))`,
    )
    .join("|"),
  "gi",
);

/** The tables a migration's SQL creates, alters, indexes or writes; comments stripped. */
export function tablesTouched({ sql }: { sql: string }): Set<string> {
  const text = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const tables = new Set<string>();
  for (const match of text.matchAll(TOUCH)) {
    const raw = match.slice(1).find(Boolean);
    if (raw) tables.add(raw.replace(QUALIFIER, "").replace(/^["`]|["`]$/g, ""));
  }
  return tables;
}

/** The one module owning every touched table (D3); `null` when mixed, unowned or none found. */
export function ownerFromTables({
  tables,
  tableOwners,
}: {
  tables: ReadonlySet<string>;
  tableOwners: ReadonlyMap<string, string>;
}): string | null {
  const owners = new Set([...tables].map((table) => tableOwners.get(table) ?? null));
  if (owners.size !== 1) return null;
  return [...owners][0] ?? null;
}

/** A shipped release with no manifest, or one following the wrong release, and how to stamp it. */
export type ReleaseManifestGap = {
  release: string;
  previous: string;
  /** Stamps from the working tree: a release PR, before its tag exists. */
  stamp: string;
  /** Stamps from the release tag: a release that already shipped. */
  stampShipped: string;
};

/** The shell commands that stamp `release`, reading `tree` when it names a tag. */
function stampCommand({
  release,
  previous,
  tree,
}: {
  release: string;
  previous: string;
  tree?: string;
}): string {
  return (
    'pnpm --filter @langwatch/architecture-enforcer print:table-owners --out "$PWD/table-owners.json" && ' +
    "node --disable-warning=ExperimentalWarning --experimental-transform-types " +
    `packages/upgrade/scripts/stamp-release.ts --release ${release} --previous ${previous} ` +
    `--table-owners table-owners.json${tree ? ` --tree ${tree}` : ""}`
  );
}

/**
 * Each release after `baseline` that has no manifest, or one that does not follow the release
 * before it; `released` is every platform release shipped, in any order.
 */
export function releaseManifestGaps({
  released,
  baseline,
  manifests,
}: {
  released: readonly string[];
  baseline: string;
  manifests: readonly Pick<ReleaseManifest, "release" | "previous">[];
}): ReleaseManifestGap[] {
  const chain = released
    .filter((release) => compareReleases({ left: release, right: baseline }) > 0)
    .toSorted((left, right) => compareReleases({ left, right }));

  return chain.flatMap((release, index) => {
    const previous = chain[index - 1] ?? baseline;
    const manifest = manifests.find((each) => each.release === release);
    if (manifest?.previous === previous) return [];

    return [
      {
        release,
        previous,
        stamp: stampCommand({ release, previous }),
        stampShipped: stampCommand({ release, previous, tree: `langwatch@v${release}` }),
      },
    ];
  });
}
