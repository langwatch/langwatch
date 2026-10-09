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

/** A contract's `-- after: <step id>`: a background step that runs before it (STEP-AFTER-2). */
const AFTER_NOTE = /^[ \t]*--[ \t]*after:[ \t]*(\S+)/gim;

/**
 * The schema steps whose SQL carries `-- contract: retired in <release>`, the destructive ones,
 * each with the background step ids its `-- after:` notes name.
 */
export function imageContractSteps({
  directories = IMAGE_MIGRATION_DIRECTORIES,
  tree = readImageTree({ directories }),
}: {
  directories?: { prisma: string; goose: string };
  tree?: ReleaseTreeSteps;
} = {}): Map<string, string[]> {
  const contracts = new Map<string, string[]>();
  const read = ({ id, path }: { id: string | null; path: string }) => {
    if (!id || !existsSync(path)) return;
    const sql = readFileSync(path, "utf8");
    if (!CONTRACT_NOTE.test(sql)) return;
    contracts.set(
      id,
      [...sql.matchAll(AFTER_NOTE)].flatMap((note) => note[1] ?? []),
    );
  };
  for (const folder of tree.prismaFolders) {
    read({ id: prismaStepId({ folder }), path: join(directories.prisma, folder, "migration.sql") });
  }
  for (const file of tree.gooseFiles) {
    read({ id: gooseStepId({ file }), path: join(directories.goose, file) });
  }
  return contracts;
}
