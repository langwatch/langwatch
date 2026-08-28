/**
 * Demo seeding entry — same code path runs in dev (CLI) and prod (cron API).
 *
 * Dev CLI:
 *   Dry run (default):  pnpm tsx scripts/dogfood/governance/seed-demo.ts
 *   Execute:            pnpm tsx scripts/dogfood/governance/seed-demo.ts --execute
 *   Override target:    pnpm tsx scripts/dogfood/governance/seed-demo.ts --org-id <id> [--execute]
 *   Custom report path: pnpm tsx scripts/dogfood/governance/seed-demo.ts --report-path /tmp/run.txt
 *
 * Prod cron path: langwatch-saas Kubernetes CronJob curls
 * `/api/cron/seed_demo` against the langwatch app pod with the
 * `CRON_API_KEY` Bearer header. The route handler in `cron.ts` imports
 * `runSeedDemo` (the named export below) and invokes it with
 * `execute: true`. Same code path as the CLI; the CLI default export
 * just adds dev-friendly side effects (console output, optional report
 * file, process.exitCode signaling).
 *
 * Env:
 *   DEMO_ORG_IDS comma-separated allowlist of org ids the seeder is
 *                permitted to touch. Refuses to run if missing,
 *                applies to dev runs too so a developer who forgets to
 *                set the allowlist gets a clear error instead of
 *                seeding random orgs.
 *
 * Default target is the FIRST id in DEMO_ORG_IDS. The cron path always
 * uses the default; the --org-id flag is for ad-hoc operator runs
 * against a secondary demo org already in the allowlist.
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { DemoOrgScope } from "./_lib/scopeGuard";
import type { SeedRunReport } from "./_lib/seedRunner";

interface ParsedArgs {
  execute: boolean;
  orgId: string | undefined;
  reportPath: string | undefined;
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  let execute = false;
  let orgId: string | undefined;
  let reportPath: string | undefined;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--org-id") {
      orgId = args[++i];
      if (orgId === undefined) {
        throw new Error("--org-id requires a value");
      }
    } else if (arg === "--report-path") {
      reportPath = args[++i];
      if (reportPath === undefined) {
        throw new Error("--report-path requires a value");
      }
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return { execute, orgId, reportPath };
}

if (isDirectExecution()) {
  void runDirectSeedDemo(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[seed-demo] fatal failure: ${message}\n`);
    process.exitCode = 1;
  });
}

async function runDirectSeedDemo(args: string[]): Promise<void> {
  const { resolveLegacyLoggerConfiguration } = await import("../../../src/runtime/logger.config");
  const { configureLogger } = await import("@langwatch/observability");
  configureLogger(resolveLegacyLoggerConfiguration(process.env));

  await execute(...args);
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

export interface RunSeedDemoOptions {
  execute: boolean;
  organizationId?: string;
  prisma?: PrismaClient;
  scope?: DemoOrgScope;
}

export async function runSeedDemo(options: RunSeedDemoOptions): Promise<SeedRunReport> {
  const runner = await import("./seed-demo.runner");
  return await runner.runSeedDemo(options);
}

export default async function execute(...args: string[]): Promise<void> {
  const runner = await import("./seed-demo.runner");
  await runner.executeSeedDemo(args);
}
