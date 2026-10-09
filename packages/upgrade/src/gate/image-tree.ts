import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ManifestStep } from "../manifest/manifest.ts";
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

/** The schema steps whose SQL carries `-- contract: retired in <release>`: the destructive ones. */
export function imageContractSteps({
  directories = IMAGE_MIGRATION_DIRECTORIES,
  tree = readImageTree({ directories }),
}: {
  directories?: { prisma: string; goose: string };
  tree?: ReleaseTreeSteps;
} = {}): Set<string> {
  const contract = (path: string) =>
    existsSync(path) && CONTRACT_NOTE.test(readFileSync(path, "utf8"));
  return new Set([
    ...tree.prismaFolders
      .filter((folder) => contract(join(directories.prisma, folder, "migration.sql")))
      .map((folder) => prismaStepId({ folder })),
    ...tree.gooseFiles
      .filter((file) => contract(join(directories.goose, file)))
      .flatMap((file) => gooseStepId({ file }) ?? []),
  ]);
}
