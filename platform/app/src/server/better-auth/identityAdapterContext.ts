import type { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "~/generated/prisma/client";
import type { IdentityCeremonies } from "~/server/app-layer/identity/identity-ceremonies";

export type DbAdapter = ReturnType<ReturnType<typeof prismaAdapter>>;
export type TransactionAdapter = Parameters<
  Parameters<DbAdapter["transaction"]>[0]
>[0];

export interface AdapterContext {
  base: DbAdapter;
  prisma: PrismaClient;
  isLatched: (params: { userId: string }) => Promise<boolean>;
  now: () => number;
  resolveCeremonies: () => Pick<
    IdentityCeremonies,
    "attachIdentifier" | "detachIdentifier" | "eraseUser"
  >;
}

/**
 * The adapter's `findMany` defaults its `limit` to 100 when none is given,
 * so a ceremony selection over an unbounded predicate must page or it
 * silently sees only the first 100 rows — and `pinnedToIds` would then
 * narrow the protocol delete to that subset. Ordered by id so offset
 * paging is stable.
 */
export async function findAllRows<Row extends { id: string }>(
  base: DbAdapter,
  {
    model,
    where,
  }: { model: string; where: Parameters<DbAdapter["delete"]>[0]["where"] },
): Promise<Row[]> {
  const pageSize = 100;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await base.findMany<Row>({
      model,
      where,
      limit: pageSize,
      offset,
      sortBy: { field: "id", direction: "asc" },
    });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/**
 * The rows the ceremony pass saw (detach or erasure) are the rows the
 * protocol write removes:
 * re-evaluating the caller's `where` after the ceremonies ran could delete
 * a row the erasure never covered (a row that started matching mid-flight)
 * or leave an erased user's row standing under a changed predicate. Pinning
 * the delete to the selected ids makes the two sets identical either way.
 */
export function pinnedToIds(
  args: Parameters<DbAdapter["delete"]>[0],
  ids: string[],
): Parameters<DbAdapter["delete"]>[0] {
  return {
    ...args,
    where: [
      ids.length === 1
        ? { field: "id", value: ids[0] as string }
        : { field: "id", operator: "in" as const, value: ids },
    ],
  };
}
