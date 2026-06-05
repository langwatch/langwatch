/**
 * Seed a tight personal budget + spend_spike AnomalyRule for the
 * live-fire anomaly-detection dogfood loop:
 *
 *   langwatch claude → small spend → anomaly fires → /governance shows
 *     the live-fired AnomalyAlert → terminal budget-exceeded proof
 *
 * Idempotent — finds existing fixture by name + updates or creates.
 *
 * Setup:
 *   - Personal budget: $0.50/month limit on the target user
 *     (small enough to hit cap with ~10 gpt-5-mini requests)
 *   - AnomalyRule: spend_spike with threshold=$0.10/hour at organization
 *     scope (fires after a few requests, well before budget cap)
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/governance/seed-anomaly-fixture.ts --email <user@org>
 *
 * Why this script is NOT a cron SeedAction: it sets up a *live-fire test
 * fixture* (tight budget, sensitive AnomalyRule thresholds tuned for
 * fast firing) tied to ONE specific user. The cron path's
 * maybeSeedAnomalyAlert (inside seed-bird-eye) already handles
 * populated-anomaly-state for the bird-eye dashboard. This script stays
 * CLI-only for the dogfood handoff: operator runs it once against a
 * test user, then fires `langwatch claude` to watch the alert
 * propagate.
 */
import { prisma } from "~/server/db";

export interface SeedAnomalyFixtureArgs {
  email: string;
}

export interface SeedAnomalyFixtureSummary {
  organizationId: string;
  userId: string;
  budgetId: string;
  ruleId: string;
  budgetCreated: boolean;
  ruleCreated: boolean;
}

function parseArgs(argv: string[]): SeedAnomalyFixtureArgs {
  let email: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i];
  }
  if (email === undefined) {
    throw new Error("--email <user@org> is required");
  }
  return { email };
}

export async function runSeedAnomalyFixture(
  args: SeedAnomalyFixtureArgs,
): Promise<SeedAnomalyFixtureSummary> {
  const user = await prisma.user.findFirst({
    where: { email: args.email },
    include: {
      orgMemberships: {
        include: {
          organization: { include: { teams: { include: { projects: true } } } },
        },
      },
    },
  });
  if (!user) throw new Error(`user ${args.email} not found`);
  const org = user.orgMemberships[0]?.organization;
  if (!org) throw new Error(`user ${args.email} has no org membership`);
  console.log(`[seed-anomaly] org=${org.id} (${org.slug}) user=${user.id}`);

  // Personal budget — PRINCIPAL scope, monthly $0.50 limit, BLOCK on breach.
  const existingBudget = await prisma.gatewayBudget.findFirst({
    where: {
      organizationId: org.id,
      scopeType: "PRINCIPAL",
      scopeId: user.id,
    },
  });
  let budgetId: string;
  let budgetCreated: boolean;
  if (existingBudget) {
    const updated = await prisma.gatewayBudget.update({
      where: { id: existingBudget.id },
      data: { limitUsd: 0.5, onBreach: "BLOCK", window: "MONTH" },
    });
    budgetId = updated.id;
    budgetCreated = false;
    console.log(
      `[seed-anomaly] updated personal budget id=${budgetId} limit=$0.50/month`,
    );
  } else {
    const now = new Date();
    const resetsAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const budget = await prisma.gatewayBudget.create({
      data: {
        organizationId: org.id,
        scopeType: "PRINCIPAL",
        scopeId: user.id,
        name: `${args.email} dogfood personal budget`,
        description: "Tight cap for live-fire anomaly-detection dogfood",
        window: "MONTH",
        limitUsd: 0.5,
        onBreach: "BLOCK",
        resetsAt,
        createdById: user.id,
      },
    });
    budgetId = budget.id;
    budgetCreated = true;
    console.log(
      `[seed-anomaly] created personal budget id=${budgetId} limit=$0.50/month`,
    );
  }

  // spend_spike AnomalyRule — organization scope. Per the schema docstring,
  // spend_spike shape is { windowSec, ratioVsBaseline, minBaselineUsd }.
  // Tight thresholds for fast firing in the dogfood demo:
  //   - 1h window
  //   - fires if spend is >= 1.5x baseline
  //   - minimum $0.05 baseline so $0 → tiny spike doesn't fire
  const ruleName = `${args.email} dogfood spend spike`;
  const existingRule = await prisma.anomalyRule.findFirst({
    where: { organizationId: org.id, name: ruleName },
  });
  const thresholdConfig = {
    windowSec: 3600,
    ratioVsBaseline: 1.5,
    minBaselineUsd: 0.05,
  };
  let ruleId: string;
  let ruleCreated: boolean;
  if (existingRule) {
    const updated = await prisma.anomalyRule.update({
      where: { id: existingRule.id },
      data: {
        ruleType: "spend_spike",
        severity: "warning",
        thresholdConfig,
        archivedAt: null,
      },
    });
    ruleId = updated.id;
    ruleCreated = false;
    console.log(`[seed-anomaly] updated rule id=${ruleId}`);
  } else {
    const rule = await prisma.anomalyRule.create({
      data: {
        organizationId: org.id,
        scope: "organization",
        scopeId: org.id,
        name: ruleName,
        description:
          "Fires when org-wide governance spend exceeds 1.5x baseline (1h window)",
        severity: "warning",
        ruleType: "spend_spike",
        thresholdConfig,
      },
    });
    ruleId = rule.id;
    ruleCreated = true;
    console.log(`[seed-anomaly] created rule id=${ruleId}`);
  }

  console.log(
    "[seed-anomaly] fixture ready. Run 'langwatch login --device' then 'langwatch claude' to fire spend.",
  );

  return {
    organizationId: org.id,
    userId: user.id,
    budgetId,
    ruleId,
    budgetCreated,
    ruleCreated,
  };
}

// CLI bootstrap — only fires when this file is the entry point.
const isCliInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliInvocation) {
  const args = parseArgs(process.argv.slice(2));
  runSeedAnomalyFixture(args)
    .catch((err) => {
      console.error("[seed-anomaly] error:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
