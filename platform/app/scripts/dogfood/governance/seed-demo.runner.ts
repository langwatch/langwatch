import { createLogger } from "@langwatch/observability";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma as defaultPrisma } from "~/server/db";
import { seedBirdEye } from "./_actions/seedBirdEye";
import { seedHeavyUsage } from "./_actions/seedHeavyUsage";
import { verifyOrgIdentity } from "./_actions/verifyOrgIdentity";
import { parseArgs, type RunSeedDemoOptions } from "./seed-demo";
import { DemoOrgScope } from "./_lib/scopeGuard";
import {
  formatReport,
  reportHasFailures,
  runSeedActions,
  type SeedAction,
  type SeedRunReport,
} from "./_lib/seedRunner";

const logger = createLogger("langwatch:scripts:dogfood:governance:seed-demo");
const ACTIONS: readonly SeedAction[] = [verifyOrgIdentity, seedBirdEye, seedHeavyUsage];

/**
 * Pure runner used by both the configured CLI and the cron API route. Returns
 * the SeedRunReport without console output, file writes, or process.exitCode
 * side effects, so the caller controls how to present the result.
 */
export async function runSeedDemo(options: RunSeedDemoOptions): Promise<SeedRunReport> {
  const scope = options.scope ?? DemoOrgScope.fromEnv();
  const targetOrgId = options.organizationId ?? scope.getAllowlist()[0];
  if (targetOrgId === undefined) {
    throw new Error("No target org id available. DemoOrgScope yielded no allowlisted entries.");
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

export async function executeSeedDemo(args: string[]): Promise<void> {
  const { execute, orgId, reportPath } = parseArgs(args);
  const report = await runSeedDemo({ execute, organizationId: orgId });
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
