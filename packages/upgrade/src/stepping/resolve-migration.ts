import { rm } from "node:fs/promises";

import { prismaErrorCode, redactOutput, runPrisma, type SteppingTools } from "./prisma-tool.ts";
import { writeReleaseDirectory } from "./release-directory.ts";

/** What `prisma migrate resolve --rolled-back` did: done, or Prisma's code and redacted output. */
export type ResolveRolledBackReport =
  | { ok: true }
  | { ok: false; code: string | null; message: string };

/**
 * Marks one failed Prisma migration rolled back, so the next `migrate deploy` applies it again.
 * Only for a migration `isRerunnablePrismaMigration` admits; `prismaFolders` must hold its folder.
 */
export async function resolveRolledBack({
  migration,
  prismaFolders,
  postgresUrl,
  environment,
  tools = {},
  signal,
}: {
  migration: string;
  prismaFolders: readonly string[];
  postgresUrl: string;
  environment: Readonly<Record<string, string | undefined>>;
  tools?: SteppingTools;
  signal?: AbortSignal;
}): Promise<ResolveRolledBackReport> {
  const directory = await writeReleaseDirectory({ folders: prismaFolders });
  try {
    const run = await runPrisma({
      directory,
      args: ["migrate", "resolve", "--rolled-back", migration],
      postgresUrl,
      environment,
      tools,
      signal,
    });
    if (run.exitCode === 0) return { ok: true };
    const message = redactOutput({ run, secrets: [postgresUrl] });
    return { ok: false, code: run.aborted ? "aborted" : prismaErrorCode({ run }), message };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
