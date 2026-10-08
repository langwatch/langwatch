import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { runTool, type ToolRun } from "./tool-run.ts";

/** Where the two migration tools are; by default the package's `prisma` and `goose` on PATH. */
export interface SteppingTools {
  prisma?: { command: string; args: readonly string[] };
  goose?: string;
}

/**
 * Runs one `prisma migrate` command over a release directory (`writeReleaseDirectory`): writes a
 * schema with only the datasource and a config naming the directory's migrations.
 */
export async function runPrisma({
  directory,
  args,
  postgresUrl,
  environment,
  tools,
  signal,
}: {
  directory: string;
  args: readonly string[];
  postgresUrl: string;
  environment: Readonly<Record<string, string | undefined>>;
  tools: SteppingTools;
  signal?: AbortSignal;
}): Promise<ToolRun> {
  const schema = join(directory, "schema.prisma");
  const config = join(directory, "prisma.config.mjs");
  await writeFile(schema, 'datasource db {\n  provider = "postgresql"\n}\n');
  const settings = { schema, migrations: { path: join(directory, "migrations") } };
  await writeFile(
    config,
    `const settings = ${JSON.stringify(settings)};\nexport default { ...settings, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  const prisma = tools.prisma ?? defaultPrisma();
  return runTool({
    command: prisma.command,
    args: [...prisma.args, ...args, "--config", config],
    cwd: directory,
    environment: { ...environment, DATABASE_URL: postgresUrl, CHECKPOINT_DISABLE: "1" },
    signal,
  });
}

/** Prisma's error code (`P3018`, `P3009`) in a run's output, when it printed one. */
export function prismaErrorCode({ run }: { run: ToolRun }): string | null {
  return /\bError: (P\d{4})\b/.exec(run.output)?.[1] ?? null;
}

/** A tool's output with every secret it was handed replaced. */
export function redactOutput({ run, secrets }: { run: ToolRun; secrets: readonly string[] }) {
  return secrets.reduce((text, secret) => text.split(secret).join("<redacted>"), run.output.trim());
}

let resolvedPrisma: { command: string; args: readonly string[] } | undefined;

/** Resolved once: a later node_modules relink by a concurrent install cannot fail a run. */
export function defaultPrisma(): { command: string; args: readonly string[] } {
  if (resolvedPrisma) return resolvedPrisma;
  const manifest = createRequire(import.meta.url).resolve("prisma/package.json");
  resolvedPrisma = { command: process.execPath, args: [join(dirname(manifest), "build/index.js")] };
  return resolvedPrisma;
}
