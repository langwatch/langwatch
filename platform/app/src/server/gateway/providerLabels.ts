import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Display names for the ModelProvider rows referenced by provider-filtered
 * budgets, so a filter renders as "OpenAI only" instead of a row id.
 * Shared by the budgets list and the applicable-budgets resolver so the
 * same provider never renders under two different names.
 */
export async function resolveProviderLabels(args: {
  prisma: PrismaClient;
  budgets: Array<{ providerKey: string | null }>;
}): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      args.budgets.map((b) => b.providerKey).filter((k): k is string => Boolean(k)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await args.prisma.modelProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, provider: true },
  });
  return new Map(rows.map((r) => [r.id, r.name || r.provider]));
}

/**
 * The display fallback every caller wants: the resolved label, else the
 * raw key, else null when the budget has no filter.
 */
export function providerLabelFor(
  labels: Map<string, string>,
  providerKey: string | null,
): string | null {
  return providerKey ? (labels.get(providerKey) ?? providerKey) : null;
}
