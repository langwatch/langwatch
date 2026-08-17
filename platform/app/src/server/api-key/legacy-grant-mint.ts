/**
 * Read-through minting for legacy API keys (ADR-092 decision 1: there is no
 * key sunset, ever).
 *
 * A credential minted before grants were rows carries no binding of its own,
 * and what it may do is decided by a branch somewhere rather than by a fact.
 * The compatibility path is not to retire the key — it is to write the fact
 * down the first time the key is used, so the same access survives the day
 * the engine becomes the decider. This is the same shape as the SHA-256 hash
 * upgrade that already rides `ApiKeyService.verify`: a legacy credential
 * quietly brought up to date on first use, off the request's critical path.
 *
 * What is minted is not a guess. `ApiKeyService.create` states the implicit
 * grant in code — a service key (no owning user) with no explicit bindings
 * "default[s] to org-wide ADMIN … the expected behavior for headless
 * automation keys that need full org access" — so a service key that predates
 * that default mints exactly that binding and nothing else. A key owned by a
 * user is a different population: `create` refuses to mint one with zero
 * bindings at all, because zero bindings means zero access there, so there is
 * no implicit grant to write down and this mints nothing for it.
 *
 * Like every other grant write, this is per-organization (decision 4): the
 * mint only runs for an organization whose genesis import has landed. For
 * everyone else the key's legacy branch keeps deciding what it may do —
 * unchanged, and with no ledger fact stated ahead of the history the import
 * still owes that organization.
 *
 * Identity is derived, not random (decision 23): the grant id is a function
 * of the fact's content and the key's own `createdAt` — its business time,
 * since that is when the access really began — and the command id is derived
 * from the key. Two requests racing before the projection lands therefore
 * emit the SAME idempotency key and dedupe at the event store, rather than
 * racing two org-ADMIN rows into a partial unique index. The same derivation
 * is what makes this converge with the cutover import rather than duplicate
 * it: both derive the same id from the same fact.
 */
import { deriveGrantId } from "@langwatch/authz-server/migration";
import { createLogger } from "@langwatch/observability";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerActor,
  type LedgerBindingAttach,
} from "~/server/app-layer/authz/ledger";
import { isOrgOnLedgerWrites } from "~/server/app-layer/authz/ledger-write-gate";
import type { ApiKeyWithBindings } from "./api-key.repository";

const logger = createLogger("langwatch:api-key:legacy-grant-mint");

/**
 * The mint acts as nobody: no user asked for it, and attributing it to the
 * key's owner would put a fact in the audit trail they never authored.
 */
const READ_THROUGH_MINT_ACTOR: LedgerActor = {
  type: "system",
  id: "system:read-through-mint",
};

/**
 * Keys this process has already emitted a mint for. The event store dedupes
 * repeats on its own (the derived idempotency key), so this is only there to
 * keep a hot legacy key from sending the same command on every request for
 * the seconds the fold takes to land the row.
 */
const emitted = new Set<string>();

/** The implicit grant a legacy key holds today, or null if it holds none. */
export function legacyGrantForKey(
  apiKey: ApiKeyWithBindings,
): LedgerBindingAttach | null {
  if (apiKey.roleBindings.length > 0) return null;
  // A key that says what it is for cannot be widened into an org admin by a
  // missing row: an ingestion credential's access is its project binding, and
  // its absence is a broken key, not an implicit grant.
  if (apiKey.ingestSourceType !== null) return null;
  if (apiKey.userId !== null) return null;

  return {
    bindingId: deriveGrantId({
      organizationId: apiKey.organizationId,
      principal: { type: "api_key", id: apiKey.id },
      scope: {
        type: RoleBindingScopeType.ORGANIZATION,
        id: apiKey.organizationId,
      },
      occurredAtMs: apiKey.createdAt.getTime(),
    }),
    principal: { apiKeyId: apiKey.id },
    role: TeamUserRole.ADMIN,
    customRoleId: null,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: apiKey.organizationId,
  };
}

/**
 * Emit the mint for a key that just authenticated — fire-and-forget.
 *
 * Deliberately not awaited by its caller and deliberately unable to fail one:
 * authentication answers with what the key can do today, and a ledger that
 * cannot take the write must never turn a working credential into a 401. A
 * failed mint is a warning and another attempt on the next request.
 */
export function mintLegacyKeyGrant({
  apiKey,
  writer,
  onLedgerWrites = isOrgOnLedgerWrites,
}: {
  apiKey: ApiKeyWithBindings;
  writer?: GrantsLedgerWriter;
  /** The per-organization write fork (decision 4); injectable for tests. */
  onLedgerWrites?: (args: { organizationId: string }) => Promise<boolean>;
}): void {
  try {
    const binding = legacyGrantForKey(apiKey);
    if (!binding) return;
    if (emitted.has(apiKey.id)) return;
    emitted.add(apiKey.id);

    void (async () => {
      // Nothing to state for an organization the genesis import has not
      // reached: its keys are still decided by the legacy branch, which is
      // untouched, and a mint would put the only ledger fact the
      // organization has in front of the history the import still owes it.
      // The guard is released rather than latched, so the first request
      // after the organization migrates mints as it should.
      if (!(await onLedgerWrites({ organizationId: apiKey.organizationId }))) {
        emitted.delete(apiKey.id);
        return;
      }
      await (writer ?? grantsLedgerWriter()).attachBindings({
        organizationId: apiKey.organizationId,
        bindings: [binding],
        actor: READ_THROUGH_MINT_ACTOR,
        source: "read-through-mint",
        onDuplicate: "skip",
        commandId: `read-through-mint:${apiKey.id}`,
        occurredAtMs: apiKey.createdAt.getTime(),
        awaitProjection: false,
      });
    })().catch((err: unknown) => failed({ apiKey, err }));
  } catch (err) {
    // Composing the writer, or deriving the fact, can fail on this thread —
    // and this function's whole contract is that authentication does not
    // notice. The async failure lands in the same place.
    failed({ apiKey, err });
  }
}

/** Let the next request try again: the queue may have been down for a
 *  moment, and the key is authenticating either way. */
function failed({
  apiKey,
  err,
}: {
  apiKey: ApiKeyWithBindings;
  err: unknown;
}): void {
  emitted.delete(apiKey.id);
  logger.warn(
    { err, apiKeyId: apiKey.id, organizationId: apiKey.organizationId },
    "failed to mint the legacy API key's grant (fire-and-forget); the key keeps working and the mint retries on its next use",
  );
}

/** Test seam: the once-per-process guard is module state. */
export function resetLegacyMintGuardForTests(): void {
  emitted.clear();
}
