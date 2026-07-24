/**
 * SeedAction wrapper around seed-heavy-usage.
 *
 * Iterates the demo org's personal projects (the per-user workspaces
 * created on first sign-in) and seeds 30 days of gateway-shaped trace
 * rows for each one's first ACTIVE VirtualKey. The /me/usage and
 * /gateway/usage charts both read from `trace_summaries`, so this is
 * what populates them.
 *
 * Personas are NOT created here. Demo users sign up through the normal
 * auth flow once per environment; the cron run reuses whatever
 * personal projects + VKs already exist in the demo org. When no
 * persona has a VK yet (fresh demo org), the action skips with a clear
 * reason instead of failing.
 *
 * Budget resolution is best-effort: if a VK has a virtual_key-scoped
 * GatewayBudget the ledger rows record against it; otherwise the
 * action seeds trace_summaries only and surfaces budget=missing in the
 * outcome summary so the operator knows to attach budgets later.
 */

import { runSeedHeavyUsage } from "../seed-heavy-usage";
import type {
  SeedAction,
  SeedActionContext,
  SeedActionOutcome,
} from "../_lib/seedRunner";

const DEFAULT_DAYS = 30;
const DEFAULT_ROWS_PER_PERSONA = 150;

interface ResolvedPersona {
  personalProjectId: string;
  virtualKeyId: string;
  budgetId: string | undefined;
}

async function resolveDemoPersonas({
  prisma,
  organizationId,
}: Pick<SeedActionContext, "prisma"> & {
  organizationId: string;
}): Promise<ResolvedPersona[]> {
  const personalTeams = await prisma.team.findMany({
    where: { organizationId, isPersonal: true },
    select: {
      id: true,
      projects: {
        where: { isPersonal: true, archivedAt: null },
        select: { id: true },
      },
    },
  });
  const personalProjectIds = personalTeams.flatMap((t) =>
    t.projects.map((p) => p.id),
  );
  if (personalProjectIds.length === 0) return [];

  const personas: ResolvedPersona[] = [];
  for (const projectId of personalProjectIds) {
    const vk = await prisma.virtualKey.findFirst({
      where: { projectId, status: "ACTIVE" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (vk === null) continue;

    const budget = await prisma.gatewayBudget.findFirst({
      where: {
        organizationId,
        scopeType: "VIRTUAL_KEY",
        scopeId: vk.id,
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    personas.push({
      personalProjectId: projectId,
      virtualKeyId: vk.id,
      budgetId: budget?.id,
    });
  }
  return personas;
}

export const seedHeavyUsage: SeedAction = {
  name: "seedHeavyUsage",
  async run({
    prisma,
    organization,
    execute,
  }: SeedActionContext): Promise<SeedActionOutcome> {
    const personas = await resolveDemoPersonas({
      prisma,
      organizationId: organization.id,
    });

    if (personas.length === 0) {
      return {
        status: "skipped",
        reason: `no demo personas yet (no personal Project + ACTIVE VirtualKey in this org). Sign up demo users + mint VKs first.`,
      };
    }

    if (!execute) {
      return {
        status: "skipped",
        reason: `dry-run: would seed ~${DEFAULT_ROWS_PER_PERSONA} rows × ${personas.length} personas = ~${DEFAULT_ROWS_PER_PERSONA * personas.length} rows over ${DEFAULT_DAYS} days`,
      };
    }

    let totalRowsInserted = 0;
    let totalCostUsd = 0;
    let personasWithBudget = 0;
    for (const persona of personas) {
      const summary = await runSeedHeavyUsage({
        personalProject: persona.personalProjectId,
        virtualKey: persona.virtualKeyId,
        budget: persona.budgetId,
        days: DEFAULT_DAYS,
        rows: DEFAULT_ROWS_PER_PERSONA,
      });
      totalRowsInserted += summary.rowsInserted;
      totalCostUsd += summary.totalCostUsd;
      if (summary.budgetSeeded) personasWithBudget += 1;
    }

    return {
      status: "succeeded",
      summary: `seeded ${totalRowsInserted} rows ($${totalCostUsd.toFixed(4)} synthetic spend) across ${personas.length} personas (${personasWithBudget} with VK-scoped budgets)`,
    };
  },
};
