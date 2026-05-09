/**
 * Demo seeding entry point — same code path runs in dev and prod.
 *
 * Dev usage:
 *   Dry run (default):  pnpm tsx scripts/dogfood/governance/seed-demo.ts
 *   Execute:            pnpm tsx scripts/dogfood/governance/seed-demo.ts --execute
 *   Override target:    pnpm tsx scripts/dogfood/governance/seed-demo.ts --org-id <id> [--execute]
 *   Custom report path: pnpm tsx scripts/dogfood/governance/seed-demo.ts --report-path /tmp/run.txt
 *
 * Prod usage (langwatch-saas Lambda + EventBridge daily cron): the cron
 * handler imports the default export of this file via the langwatch
 * submodule and invokes it with `DEMO_ORG_IDS` set from AWS Parameter
 * Store and `--execute` always passed.
 *
 * Env:
 *   DEMO_ORG_IDS comma-separated allowlist of org ids the seeder is
 *                permitted to touch. Refuses to run if missing — applies
 *                to dev runs too, so a developer who forgets to set the
 *                allowlist gets a clear error instead of seeding random
 *                orgs.
 *
 * Default target is the FIRST id in DEMO_ORG_IDS. The cron path always
 * uses the default; the --org-id flag is for ad-hoc operator runs
 * against a secondary demo org already in the allowlist.
 */

import { createLogger } from "~/utils/logger";
import { prisma } from "~/server/db";
import * as fs from "fs";
import * as path from "path";
import { verifyOrgIdentity } from "./_actions/verifyOrgIdentity";
import { DemoOrgScope } from "./_lib/scopeGuard";
import {
  formatReport,
  reportHasFailures,
  runSeedActions,
  type SeedAction,
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

const ACTIONS: readonly SeedAction[] = [verifyOrgIdentity];

export default async function execute(...args: string[]): Promise<void> {
  const { execute: executeMode, orgId: overrideOrgId, reportPath } = parseArgs(args);

  const scope = DemoOrgScope.fromEnv();
  const allowlist = scope.getAllowlist();
  const targetOrgId = overrideOrgId ?? allowlist[0];
  if (targetOrgId === undefined) {
    throw new Error(
      "No target org id available. DEMO_ORG_IDS yielded no entries (this should have been caught upstream).",
    );
  }
  scope.assertOrgIdAllowed(targetOrgId);

  logger.info(
    { mode: executeMode ? "execute" : "dry-run", targetOrgId, allowlist },
    "starting demo seed run",
  );

  const report = await runSeedActions({
    prisma,
    scope,
    organizationId: targetOrgId,
    actions: ACTIONS,
    execute: executeMode,
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
