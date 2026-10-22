import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadReleaseBaseline, type ReleaseBaseline } from "../manifest/baseline.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import {
  gooseStepId,
  prismaStepId,
  type ReleaseTreeSteps,
  stampRelease,
  treeStepIds,
} from "../manifest/stamp.ts";

/** Where this image ships its Postgres and ClickHouse migrations, beside this package. */
export const IMAGE_MIGRATION_DIRECTORIES = {
  prisma: fileURLToPath(new URL("../../../prisma-client/prisma/migrations/", import.meta.url)),
  goose: fileURLToPath(new URL("../../../clickhouse-migrations/migrations/", import.meta.url)),
} as const;

/** The image's own tree: every Prisma folder and goose file it ships, and its code steps. */
export function readImageTree({
  directories = IMAGE_MIGRATION_DIRECTORIES,
  codeSteps = [],
}: {
  directories?: { prisma: string; goose: string };
  codeSteps?: readonly ManifestStep[];
} = {}): ReleaseTreeSteps {
  return {
    prismaFolders: readdirSync(directories.prisma).filter((name) => /^\d{14}_/.test(name)),
    gooseFiles: readdirSync(directories.goose).filter((name) => name.endsWith(".sql")),
    codeSteps,
  };
}

/** Every Prisma folder in the image's migrations directory, `0_init` included (UD-F2). */
export function imagePrismaFolders({
  directory = IMAGE_MIGRATION_DIRECTORIES.prisma,
}: { directory?: string } = {}): string[] {
  return readdirSync(directory).filter((name) =>
    existsSync(join(directory, name, "migration.sql")),
  );
}

/** One Prisma folder's SQL in the image, or null when the image does not ship it. */
export function imagePrismaSql({
  folder,
  directory = IMAGE_MIGRATION_DIRECTORIES.prisma,
}: {
  folder: string;
  directory?: string;
}): string | null {
  const path = join(directory, folder, "migration.sql");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * What the serving gate requires and what the serving roster declares (blitz plan 3.1, 5.3): the
 * blocking ids are the tree's schema and blocking code steps, the same ids the runner registers.
 * `withClickHouse: false` leaves the ClickHouse ids out (held question S3-NO-CLICKHOUSE).
 */
export function imageGateSteps({
  tree,
  withClickHouse,
}: {
  tree: ReleaseTreeSteps;
  withClickHouse: boolean;
}): { blockingSteps: string[]; declaredSteps: string[] } {
  const blocking = treeStepIds({
    tree: {
      prismaFolders: tree.prismaFolders,
      gooseFiles: withClickHouse ? tree.gooseFiles : [],
      codeSteps: tree.codeSteps.filter((step) => step.mode === "blocking"),
    },
  });
  return {
    blockingSteps: [...blocking].toSorted(),
    declaredSteps: tree.codeSteps.filter((step) => step.mode !== "blocking").map(({ id }) => id),
  };
}

/** The tree's step ids no manifest and no baseline step names: what makes an image unreleased. */
export function unstampedSteps({
  manifests,
  tree,
  baseline = loadReleaseBaseline(),
}: {
  manifests: readonly ReleaseManifest[];
  tree: ReleaseTreeSteps;
  baseline?: ReleaseBaseline;
}): string[] {
  const stamped = new Set([
    ...baseline.steps,
    ...manifests.flatMap((manifest) => manifest.steps.map(({ id }) => id)),
  ]);
  return [...treeStepIds({ tree })].filter((id) => !stamped.has(id));
}

/**
 * The release this image is (IMAGE-IDENTITY): the newest stamped manifest, or the baseline's
 * release when it ships none, only when the tree ships no step beyond the stamped ones, else
 * null, "unreleased". Spec: specs/upgrade/release-manifests.feature.
 */
export function imageRelease({
  manifests,
  tree,
  baseline = loadReleaseBaseline(),
}: {
  manifests: readonly ReleaseManifest[];
  tree: ReleaseTreeSteps;
  baseline?: ReleaseBaseline;
}): string | null {
  if (unstampedSteps({ manifests, tree, baseline }).length > 0) return null;
  return manifests.at(-1)?.release ?? baseline.release;
}

/** What writes a release's manifest; a refusal names it. */
export const STAMP_RELEASE_COMMAND =
  "node --experimental-transform-types packages/upgrade/scripts/stamp-release.ts";

const LISTED_UNSTAMPED = 10;

export type ReleaseIdentityRefusal = {
  code: "manifest_missing" | "steps_unstamped" | "release_mismatch";
  message: string;
};

/**
 * Why a tree cut as `release` would not name itself that release, or null when it would. The
 * release PR and the image publish refuse on it. Spec: specs/upgrade/release-manifests.feature.
 */
export function releaseIdentityRefusal({
  release,
  manifests,
  tree,
  baseline = loadReleaseBaseline(),
}: {
  release: string;
  manifests: readonly ReleaseManifest[];
  tree: ReleaseTreeSteps;
  baseline?: ReleaseBaseline;
}): ReleaseIdentityRefusal | null {
  if (!manifests.some((manifest) => manifest.release === release)) {
    return {
      code: "manifest_missing",
      message: `packages/upgrade/releases/${release}.json is missing; stamp it with \`${STAMP_RELEASE_COMMAND}\``,
    };
  }
  const unstamped = unstampedSteps({ manifests, tree, baseline });
  if (unstamped.length > 0) {
    const listed = unstamped.slice(0, LISTED_UNSTAMPED).join(", ");
    const more =
      unstamped.length > LISTED_UNSTAMPED ? ` and ${unstamped.length - LISTED_UNSTAMPED} more` : "";
    return {
      code: "steps_unstamped",
      message: `${unstamped.length} steps of this tree are in no manifest (${listed}${more}); stamp ${release} again with \`${STAMP_RELEASE_COMMAND}\``,
    };
  }
  const named = imageRelease({ manifests, tree, baseline });
  if (named !== release) {
    return {
      code: "release_mismatch",
      message: `this tree names itself ${named ?? "unreleased"}, not ${release}: it ships a manifest newer than the release`,
    };
  }
  return null;
}

/**
 * The release's manifest over a whole tree, code steps included: every step no earlier manifest
 * and no baseline names, so a release after one cut without its manifest also carries that one's
 * steps. Refused when the result would still not name the tree this release.
 */
export function stampTreeRelease({
  release,
  previous,
  cutAt,
  tree,
  earlier,
  baseline = loadReleaseBaseline(),
  ownerOf,
}: {
  release: string;
  previous: string | null;
  cutAt: string;
  tree: ReleaseTreeSteps;
  earlier: readonly ReleaseManifest[];
  baseline?: ReleaseBaseline;
  ownerOf: ({ id }: { id: string }) => string | null;
}):
  | { manifest: ReleaseManifest; refusal: null }
  | { manifest: null; refusal: ReleaseIdentityRefusal } {
  const shipped = new Set([
    ...baseline.steps,
    ...earlier.flatMap((manifest) => manifest.steps.map(({ id }) => id)),
  ]);
  const manifest = stampRelease({ release, previous, cutAt, current: tree, shipped, ownerOf });
  const refusal = releaseIdentityRefusal({
    release,
    manifests: [...earlier, manifest],
    tree,
    baseline,
  });
  return refusal ? { manifest: null, refusal } : { manifest, refusal: null };
}

/** Every Prisma folder and goose file this image ships, as steps (ids per blitz plan 5.3). */
export function imageSteps({
  release,
  tree = readImageTree(),
}: {
  release: string;
  tree?: ReleaseTreeSteps;
}) {
  return stampRelease({
    release,
    previous: null,
    cutAt: "1970-01-01T00:00:00Z",
    current: tree,
    shipped: new Set(),
    ownerOf: () => null,
  }).steps;
}

/** The note the migration-safety rules require above every destructive statement. */
const CONTRACT_NOTE = /--[ \t]*contract:[ \t]*retired in[ \t]+\S+/i;

/** A contract's `-- archive: <table>`: a table it drops, archived first (Alex, 2026-10-09). */
const ARCHIVE_NOTE = /^[ \t]*--[ \t]*archive:[ \t]*(?!none\b)(\S+)/gim;

/** Each schema step whose SQL carries `-- contract: retired in <release>`, with that SQL. */
function readContractSql({
  directories,
  tree,
}: {
  directories: { prisma: string; goose: string };
  tree: ReleaseTreeSteps;
}): Map<string, string> {
  const contracts = new Map<string, string>();
  const read = ({ id, path }: { id: string | null; path: string }) => {
    if (!id || !existsSync(path)) return;
    const sql = readFileSync(path, "utf8");
    if (CONTRACT_NOTE.test(sql)) contracts.set(id, sql);
  };
  for (const folder of tree.prismaFolders) {
    read({ id: prismaStepId({ folder }), path: join(directories.prisma, folder, "migration.sql") });
  }
  for (const file of tree.gooseFiles) {
    read({ id: gooseStepId({ file }), path: join(directories.goose, file) });
  }
  return contracts;
}

const notesOf = ({ sql, note }: { sql: string; note: RegExp }) =>
  [...sql.matchAll(note)].flatMap((match) => match[1] ?? []);

/** The contract steps that archive, each with the tables its `-- archive:` notes name. */
export function imageContractArchives({
  directories = IMAGE_MIGRATION_DIRECTORIES,
  tree = readImageTree({ directories }),
}: {
  directories?: { prisma: string; goose: string };
  tree?: ReleaseTreeSteps;
} = {}): Map<string, string[]> {
  const archives = new Map<string, string[]>();
  for (const [id, sql] of readContractSql({ directories, tree })) {
    const tables = notesOf({ sql, note: ARCHIVE_NOTE });
    if (tables.length > 0) archives.set(id, tables);
  }
  return archives;
}
