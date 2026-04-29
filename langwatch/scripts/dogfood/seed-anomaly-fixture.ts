/**
 * Seed a tight personal budget + spend_spike AnomalyRule for the
 * iter28-followup live-data dogfood pass. When Sergey's 3e
 * SpendSpikeAnomalyEvaluator lands, this fixture lets Lane-B drive:
 *
 *   langwatch claude → small spend → anomaly fires → /governance shows
 *     the live-fired AnomalyAlert → Screen 8 budget-exceeded terminal
 *     proof
 *
 * Idempotent — finds existing fixture by name + updates or creates.
 *
 * Setup:
 *   - Personal budget: $0.50/month limit on alexis-dogfood@acme.invalid
 *     (small enough to hit cap with ~10 gpt-5-mini requests)
 *   - AnomalyRule: spend_spike with threshold=$0.10/hour at organization
 *     scope (fires after a few requests, well before budget cap)
 */
import { prisma } from "~/server/db";

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: "alexis-dogfood@acme.invalid" },
    include: {
      orgMemberships: {
        include: {
          organization: { include: { teams: { include: { projects: true } } } },
        },
      },
    },
  });
  if (!user) throw new Error("user alexis-dogfood@acme.invalid not found");
  const org = user.orgMemberships[0]?.organization;
  if (!org) throw new Error("no org membership");
  console.log(`[seed-anomaly] org=${org.id} (${org.slug}) user=${user.id}`);

  // Personal budget — PRINCIPAL scope, monthly $0.50 limit, BLOCK on breach.
  const existingBudget = await prisma.gatewayBudget.findFirst({
    where: {
      organizationId: org.id,
      scopeType: "PRINCIPAL",
      principalUserId: user.id,
    },
  });
  if (existingBudget) {
    await prisma.gatewayBudget.update({
      where: { id: existingBudget.id },
      data: { limitUsd: 0.5, onBreach: "BLOCK", window: "MONTH" },
    });
    console.log(`[seed-anomaly] updated personal budget id=${existingBudget.id} limit=$0.50/month`);
  } else {
    const now = new Date();
    const resetsAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const budget = await prisma.gatewayBudget.create({
      data: {
        organizationId: org.id,
        scopeType: "PRINCIPAL",
        scopeId: user.id,
        principalUserId: user.id,
        name: "Alexis Dogfood Personal Budget",
        description: "Tight cap for iter28-followup demo dogfood",
        window: "MONTH",
        limitUsd: 0.5,
        onBreach: "BLOCK",
        resetsAt,
        createdById: user.id,
      },
    });
    console.log(`[seed-anomaly] created personal budget id=${budget.id} limit=$0.50/month`);
  }

  // spend_spike AnomalyRule — organization scope. Per the schema docstring,
  // spend_spike shape is { windowSec, ratioVsBaseline, minBaselineUsd }.
  // Tight thresholds for fast firing in the iter28-followup demo:
  //   - 1h window
  //   - fires if spend is >= 1.5x baseline
  //   - minimum $0.05 baseline so $0 → tiny spike doesn't fire
  const ruleName = "Alexis Dogfood Spend Spike";
  const existingRule = await prisma.anomalyRule.findFirst({
    where: { organizationId: org.id, name: ruleName },
  });
  const thresholdConfig = {
    windowSec: 3600,
    ratioVsBaseline: 1.5,
    minBaselineUsd: 0.05,
  };
  if (existingRule) {
    await prisma.anomalyRule.update({
      where: { id: existingRule.id },
      data: {
        ruleType: "spend_spike",
        severity: "warning",
        thresholdConfig,
        archivedAt: null,
      },
    });
    console.log(`[seed-anomaly] updated rule id=${existingRule.id}`);
  } else {
    const rule = await prisma.anomalyRule.create({
      data: {
        organizationId: org.id,
        scope: "organization",
        scopeId: org.id,
        name: ruleName,
        description: "Fires when org-wide governance spend exceeds 1.5x baseline (60s window)",
        severity: "warning",
        ruleType: "spend_spike",
        thresholdConfig,
      },
    });
    console.log(`[seed-anomaly] created rule id=${rule.id}`);
  }

  console.log("[seed-anomaly] fixture ready. Run 'langwatch login --device' then 'langwatch claude' to fire spend.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seed-anomaly] error:", err);
  process.exitCode = 1;
});
