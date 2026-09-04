import type {
  AppendLinkInput,
  EraseIdentifiersInput,
  EraseIdentifiersResult,
  IdentityLinkRow,
  LoginRef,
} from "./types";

/**
 * The add-only storage contract (ADR-094 Decision 3 / Invariants "Add-only").
 * The ONLY mutators are `appendLink` and `eraseIdentifiers` — there is no
 * update and no delete, and a test pins the mutator surface to exactly these
 * two. Every call is scoped by `organizationId`; the implementation must
 * validate that `providerConnectionId` belongs to that organization before
 * any insert (Invariants "Organization isolation").
 *
 * This interface exposes nothing shaped like a permission check, and the
 * access-control packages must never depend on this package (Decision 10;
 * enforced by the dependency test, not by review).
 */
export interface IdentityLinkStorage {
  /**
   * Append one row: a link, a correction, or (userId null) an unlink.
   * Never updates an existing row.
   */
  appendLink(input: AppendLinkInput): Promise<IdentityLinkRow>;

  /**
   * The single named exception to add-only (Decision 9): blank who the
   * person WAS — `userId`, `actorUserId`, email-kind `externalId` values —
   * in place, stamping `erasedAt` on every touched row. Never removes a row
   * and never touches which rows exist.
   */
  eraseIdentifiers(
    input: EraseIdentifiersInput,
  ): Promise<EraseIdentifiersResult>;

  /**
   * All rows for the given logins in one organization, in no guaranteed
   * order — resolution sorts. Each login's rows are matched on the full
   * (provider, providerConnectionId, externalKind, externalId) key, so
   * lookups never cross connections (Decision 2).
   */
  listLinksForLogins(
    organizationId: string,
    logins: readonly LoginRef[],
  ): Promise<IdentityLinkRow[]>;
}
