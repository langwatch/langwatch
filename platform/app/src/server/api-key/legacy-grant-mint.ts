/**
 * Read-through minting for legacy API keys (ADR-092 decision 1: there is no
 * key sunset, ever). A credential minted before grants were rows carries no
 * binding of its own, and what it may do is decided by a branch rather than
 * a fact. The compatibility path writes the fact down the first time the
 * key is used, so the same access survives the day the engine becomes the
 * decider.
 *
 * ABSENCE IS NOT A GRANT. A service key with no bindings authorizes nothing
 * today — `resolveApiKeyPermission` asks the key's own bindings first and
 * denies when there are none — so the org-wide ADMIN written here is access
 * the credential does not currently have, correct only for a key that
 * genuinely predates the ledger era. Every other zero-binding key is either
 * broken or momentarily mid-write (a replace that has attached but not yet
 * revoked, a projection still catching up), and widening one to
 * organization ADMIN would be an escalation, not a migration.
 *
 * So the gate is TIME, not shape: the key's own `createdAt` must be strictly
 * earlier than the moment this organization's genesis import actually
 * transitioned this organization onto the ledger (`SystemMigrationTenantState`
 * for `AUTHZ_ENGINE_MIGRATION_NAME`, read as that row's own
 * `occurredAt` when its `status` is `migrated` or `finalized` — the two
 * statuses engine-gate.ts already treats as "the ledger holds this
 * organization's history"). A key created at or after that moment was born
 * into the ledger era and is never minted for, no matter how many bindings it
 * holds. An unreadable, absent, or not-yet-cutover state row (`parked`,
 * `rolled_back`, or no row at all) mints nothing.
 *
 * The row is a single upserted state, not a history, so `createdAt` — when
 * the row FIRST appeared — is not read here: an organization can sit
 * `parked` for weeks before it actually migrates, and blending that early
 * timestamp in (the old gate took `min(createdAt, occurredAt)`) let the whole
 * parked period masquerade as ledger era, silently excluding every key
 * created in it from ever minting. `status` says which transition the row's
 * `occurredAt` belongs to, which is what keeps the boundary pinned to the
 * actual cutover instead of either the parked attempt before it or a later
 * unrelated write.
 *
 * The shape checks stay on top of the time gate: an ingestion key (its
 * access IS its project binding) and a user-owned key (`create` refuses
 * zero bindings there) mint nothing either way.
 *
 * Per-organization (decision 4): the mint only runs for an organization
 * whose genesis import has landed; everyone else's legacy branch keeps
 * deciding what the key may do.
 *
 * Identity is derived, not random (decision 23): the grant id is a function
 * of the fact's content and the key's own `createdAt` (its business time),
 * and the command id is derived from the key. Two requests racing before
 * the projection lands emit the SAME idempotency key and dedupe at the
 * event store, rather than racing two org-ADMIN rows into a partial unique
 * index — the same derivation the cutover import uses, so the two converge
 * rather than duplicate.
 */
import type { LedgerActor } from "@langwatch/actor";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { deriveGrantId } from "@langwatch/authz-server/migration";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { organizationOnAuthzEngine } from "~/server/app-layer/authz/engine-gate";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerBindingAttach,
} from "~/server/app-layer/authz/ledger";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "~/server/app-layer/authz/migration-name";
import { prisma as appPrisma } from "~/server/db";
import type { ApiKeyWithBindings } from "./api-key.repository";

const logger = createLogger("langwatch:api-key:legacy-grant-mint");

/**
 * The mint acts as nobody: no user asked for it, and attributing it to the
 * key's owner would put a fact in the audit trail they never authored.
 */
const READ_THROUGH_MINT_ACTOR: LedgerActor = {
  type: "system",
  id: SYSTEM_ACTORS.readThroughMint,
};

/**
 * How long one key's "already emitted" note counts for.
 *
 * The event store dedupes repeats on its own (the derived idempotency key),
 * so this note only keeps a hot legacy key from sending the same command on
 * every request for the seconds the fold takes to land the row. A minute is
 * far longer than that window and short enough that the note is a cache
 * rather than a record.
 */
const MINT_GUARD_TTL_MS = 60_000;

/**
 * The ceiling on how many notes are held at once. The guard used to be a Set
 * that only ever grew: one entry per legacy key the pod ever authenticated,
 * for the life of the process. A TTL alone does not bound that — an entry
 * whose key never authenticates again is never looked at, so it is never
 * dropped — hence the sweep below.
 */
const MINT_GUARD_MAX_ENTRIES = 10_000;

/** apiKeyId → the moment its note stops counting. */
const emitted = new Map<string, number>();

/** Whether this key's mint is still in flight (or freshly landed). */
function guardHeld(apiKeyId: string): boolean {
  const expiresAt = emitted.get(apiKeyId);
  if (expiresAt === undefined) return false;
  if (Date.now() < expiresAt) return true;
  emitted.delete(apiKeyId);
  return false;
}

function holdGuard(apiKeyId: string): void {
  if (emitted.size >= MINT_GUARD_MAX_ENTRIES) sweepGuard();
  emitted.set(apiKeyId, Date.now() + MINT_GUARD_TTL_MS);
}

/**
 * Drop the expired notes, and if that was not enough, drop them all. Losing
 * the guard entirely costs at most one duplicate command per hot key, which
 * the event store dedupes on the derived idempotency key; holding an
 * unbounded map costs the pod.
 */
function sweepGuard(): void {
  const now = Date.now();
  for (const [apiKeyId, expiresAt] of emitted) {
    if (expiresAt <= now) emitted.delete(apiKeyId);
  }
  if (emitted.size >= MINT_GUARD_MAX_ENTRIES) emitted.clear();
}

/**
 * The statuses that mean this organization's migration actually cut it
 * over — mirrors `ON_ENGINE_STATUSES` in engine-gate.ts (kept as its
 * own literal here rather than imported: that gate answers a present-tense
 * "is this organization on the ledger today", this answers "when did it get
 * there", and the two must not be forced to share a type only one of them
 * needs).
 *
 * `finalized` only, matching the gate: `migrated` is the HELD state — the
 * organization's writes are still imperative legacy rows, so a key created
 * while held belongs to the legacy era and the next migration pass adopts
 * its bindings; there is no ledger era to date it against yet.
 */
const CUTOVER_STATUSES: readonly string[] = ["finalized"];

/**
 * The moment this organization's genesis import actually cut it over onto the
 * ledger, or null when there is none to read yet.
 *
 * `SystemMigrationTenantState` holds one row per (migration, tenant),
 * upserted in place — not a history of every status it has passed through.
 * `occurredAt` is the business time of whichever transition is CURRENT, and
 * `status` says which one that is: reading it only when `status` is
 * `migrated` or `finalized` is what keeps a `parked` attempt's row (an
 * organization can sit parked for weeks before it actually migrates) from
 * being mistaken for the cutover itself. Anything else — `pending`,
 * `parked`, `rolled_back`, or no row — has no cutover to report, so this
 * returns null and the caller mints nothing (fail-safe: absence must never
 * be read as "long ago").
 *
 * The one gap this cannot close: if an organization passes through
 * `migrated` (with reconcilable drift) before later reaching `finalized`,
 * the row's single `occurredAt` moves to the `finalized` transition's time
 * and the earlier `migrated` moment is gone — nothing about this table keeps
 * it. A key created in that gap is, at worst, minted (or excluded) one
 * transition later than the organization's true cutover; there is no data
 * here to do better, and the direction is still bounded (never earlier than
 * the true cutover) rather than open-ended.
 */
export async function genesisImportMoment({
  organizationId,
  prisma = appPrisma,
}: {
  organizationId: string;
  prisma?: Pick<PrismaClient, "systemMigrationTenantState">;
}): Promise<Date | null> {
  try {
    const row = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
          tenantId: organizationId,
        },
      },
      select: { status: true, occurredAt: true },
    });
    if (!row || !CUTOVER_STATUSES.includes(row.status)) return null;
    return row.occurredAt;
  } catch (err) {
    // Fail safe: an unreadable state table mints nothing, which is exactly
    // the behaviour of an organization that has not migrated.
    logger.warn(
      { err, organizationId },
      "could not read the genesis import's state row; minting nothing for this key",
    );
    return null;
  }
}

/**
 * Whether the credential itself predates the ledger era — the only population
 * whose absent bindings mean "decided by a branch" rather than "grants none".
 */
export function keyPredatesLedger({
  apiKey,
  genesisAt,
}: {
  apiKey: Pick<ApiKeyWithBindings, "createdAt">;
  genesisAt: Date | null;
}): boolean {
  if (!genesisAt) return false;
  return apiKey.createdAt.getTime() < genesisAt.getTime();
}

/**
 * The implicit grant a legacy key holds today, or null if it holds none.
 *
 * Shape only — whether the key is old enough for that shape to mean anything
 * is {@link keyPredatesLedger}, and both must hold before anything is
 * written.
 */
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
      principal: { type: "apiKey", id: apiKey.id },
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
  onLedgerWrites = ({ organizationId }) =>
    organizationOnAuthzEngine({ prisma: appPrisma, organizationId }),
  genesisMomentFor = genesisImportMoment,
}: {
  apiKey: ApiKeyWithBindings;
  writer?: GrantsLedgerWriter;
  /** The per-organization write fork (decision 4); injectable for tests. */
  onLedgerWrites?: (args: { organizationId: string }) => Promise<boolean>;
  /** The organization's ledger-era boundary; injectable for tests. */
  genesisMomentFor?: (args: { organizationId: string }) => Promise<Date | null>;
}): void {
  try {
    const binding = legacyGrantForKey(apiKey);
    if (!binding) return;
    if (guardHeld(apiKey.id)) return;
    holdGuard(apiKey.id);

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
      // The predate gate. A key born into the ledger era holds exactly the
      // grants it was given, and none is none — a transiently empty set (a
      // replace mid-flight, a projection catching up) must read as "nothing
      // to state", never as "widen this to organization ADMIN". The note is
      // left standing here rather than released: the answer for this key
      // cannot change until the note expires anyway, so releasing it would
      // only re-ask the same two questions on the next request.
      if (
        !keyPredatesLedger({
          apiKey,
          genesisAt: await genesisMomentFor({
            organizationId: apiKey.organizationId,
          }),
        })
      ) {
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

/** Test seam: the short-lived emission notes are module state. */
export function resetLegacyMintGuardForTests(): void {
  emitted.clear();
}
