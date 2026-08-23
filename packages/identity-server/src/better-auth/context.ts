import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityUsersRepository } from "../identity-users.repository";
import type { IdentityService } from "../identity.service";

/** better-auth's own adapter contract — the row engine the facade wraps. */
export type DbAdapter = DBAdapter;
export type TransactionAdapter = DBTransactionAdapter;

/** What the facade's ceremonies need, resolved once per adapter instance. */
export interface AdapterContext {
  base: DbAdapter;
  heads: Pick<IdentityHeadsRepository, "findIdentifierIdForAccount">;
  users: IdentityUsersRepository;
  identity: Pick<
    IdentityService,
    "attachIdentifier" | "detachIdentifier" | "eraseUser"
  >;
  isLatched: (args: { userId: string }) => Promise<boolean>;
  now: () => number;
  newCommandId: () => string;
}

/**
 * The adapter's `findMany` defaults its `limit` to 100 when none is given,
 * so a ceremony selection over an unbounded predicate must page or it
 * silently sees only the first 100 rows — and `pinnedToIds` would then
 * narrow the protocol delete to that subset. Ordered by id so offset
 * paging is stable.
 */
export async function findAllRows<Row extends { id: string }>(
  base: Pick<DbAdapter, "findMany">,
  { model, where }: { model: string; where: Where[] | undefined },
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
 * protocol write removes: re-evaluating the caller's `where` after the
 * ceremonies ran could delete a row the erasure never covered (a row that
 * started matching mid-flight) or leave an erased user's row standing under
 * a changed predicate. Pinning the delete to the selected ids makes the two
 * sets identical either way.
 */
export function pinnedToIds<Args extends { where: Where[] }>(
  args: Args,
  ids: string[],
): Args {
  return {
    ...args,
    where: [
      ids.length === 1
        ? { field: "id", value: ids[0] as string }
        : { field: "id", operator: "in" as const, value: ids },
    ],
  };
}
