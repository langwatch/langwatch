import type { PrismaClient } from "@langwatch/prisma-client/generated";

export type TraceProject = { id: string; teamId: string };

/** Batch-loads trace destinations for the budget reach calculation. */
export async function traceProjectsByIds(
  client: PrismaClient,
  traceProjectIds: (string | null | undefined)[],
): Promise<Map<string, TraceProject>> {
  const ids = [
    ...new Set(
      traceProjectIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await client.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, teamId: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}
