/**
 * Which virtual keys are someone's own (modules/gateway/specs/gateway-budget-service.feature).
 * The LangWatchQL budget views state the same rule in SQL, in analytics' visibility overrides.
 * They differ on a key row that is gone: SQL reads it as shared, which is moot there since a
 * Postgres ledger row goes with its key; the detail screen reads ClickHouse rows that outlive it.
 */

/** Who a virtual key belongs to, as the personal-key rule reads it. */
export type VirtualKeyOwnership = Readonly<{
  principalUserId: string | null;
  mintedAsPersonal: boolean;
  createdById: string;
}>;

/** The creator a project credential or a user-less API key writes: `svc_<projectId>`. */
const MACHINE_CREATOR_PREFIX = "svc_";

/** Personal on its own columns: it has a principal, or it was minted with one. */
export function isMarkedPersonal({
  principalUserId,
  mintedAsPersonal,
}: VirtualKeyOwnership): boolean {
  return principalUserId !== null || mintedAsPersonal;
}

/**
 * Unmarked and made by a person: such a key counts as personal once its creator's account is gone,
 * which catches a key whose owner was erased before the mark existed. A machine never qualifies.
 */
export function hangsOnItsCreator(owner: VirtualKeyOwnership): boolean {
  return !isMarkedPersonal(owner) && !owner.createdById.startsWith(MACHINE_CREATOR_PREFIX);
}
