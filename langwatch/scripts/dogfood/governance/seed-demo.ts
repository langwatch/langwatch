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

import * as fs from "fs";
import * as path from "path";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger";
import { seedBirdEye } from "./_actions/seedBirdEye";
import { seedHeavyUsage } from "./_actions/seedHeavyUsage";
import { verifyOrgIdentity } from "./_actions/verifyOrgIdentity";
import { DemoOrgScope } from "./_lib/scopeGuard";
import type { PrismaClient } from "@prisma/client";
import {
  formatReport,
  reportHasFailures,
  runSeedActions,
  type SeedAction,
  type SeedRunReport,
} from "./_lib/seedRunner";

const logger = createLogger("langwatch:scripts:dogfood:governance:seed-demo");

interface ParsedArgs {
  execute: boolean;
  orgId: string | undefined;
  reportPath: string | undefined;
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  let execute = false;
  let orgId: string | undefined;
  let reportPath: string | undefined;
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

const ACTIONS: readonly SeedAction[] = [
  verifyOrgIdentity,
  seedBirdEye,
  seedHeavyUsage,
];

export interface RunSeedDemoOptions {
  execute: boolean;
  organizationId?: string;
  prisma?: PrismaClient;
  scope?: DemoOrgScope;
}

/**
 * Pure runner used by both the CLI default export and the cron API
 * route. Returns the SeedRunReport without console output, file writes,
 * or process.exitCode side effects, so the caller controls how to
 * present the result.
 */
export async function runSeedDemo(
  options: RunSeedDemoOptions,
): Promise<SeedRunReport> {
  const scope = options.scope ?? DemoOrgScope.fromEnv();
  const targetOrgId = options.organizationId ?? scope.getAllowlist()[0];
  if (targetOrgId === undefined) {
    throw new Error(
      "No target org id available. DemoOrgScope yielded no allowlisted entries.",
    );
  }
  scope.assertOrgIdAllowed(targetOrgId);

  logger.info(
    {
      mode: options.execute ? "execute" : "dry-run",
      targetOrgId,
      allowlist: scope.getAllowlist(),
    },
    "starting demo seed run",
  );

  return runSeedActions({
    prisma: options.prisma ?? defaultPrisma,
    scope,
    organizationId: targetOrgId,
    actions: ACTIONS,
    execute: options.execute,
  });
}

export default async function execute(...args: string[]): Promise<void> {
  const { execute: executeMode, orgId, reportPath } = parseArgs(args);

  const report = await runSeedDemo({
    execute: executeMode,
    organizationId: orgId,
  });

  const formatted = formatReport(report);
  console.log("\n" + formatted + "\n");

  if (reportPath !== undefined) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, formatted + "\n");
    logger.info({ reportPath }, "report written");
  }

  if (reportHasFailures(report)) {
    logger.error("demo seed run had failures");
    process.exitCode = 1;
  }
}
