import type { PrismaClient } from "@prisma/client";

/**
 * Display names for the ModelProvider rows referenced by provider-filtered
 * budgets, so a filter renders as "OpenAI only" instead of a row id.
 * Shared by the budgets list and the applicable-budgets resolver so the
 * same provider never renders under two different names.
 */
export async function resolveProviderLabels(
  prisma: PrismaClient,
  budgets: Array<{ providerKey: string | null }>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      budgets.map((b) => b.providerKey).filter((k): k is string => Boolean(k)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await prisma.modelProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, provider: true },
  });
  return new Map(rows.map((r) => [r.id, r.name || r.provider]));
}
