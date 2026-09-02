import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IdentityEmailInUseError,
  type IdentityFactInput,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";
import { deriveNewbornUserId } from "../crypto/identifier-identity";
import { type IdentityGuards } from "../guards";
import { adoptUserEmailCommandId } from "../identity-command-id";
import { type IdentityReservationRepository } from "../identity-reservations.repository";
import { IdentityEngineUnavailableError, type IdentityBirthPort, type IdentityNewborn } from "../better-auth/identity-birth";
import { createLogger } from "@langwatch/observability";
import { type IdentityEvent, identityEventsFor } from "@langwatch/identity-eventing";
import type { IdentityLedgerWriter } from "../adapters/identity-ledger.adapter";
import type { PrismaIdentityNewbornRepository } from "../repositories/prisma/prisma.identity-newborn.repository";

const logger = createLogger("langwatch:identity:birth");

export interface IdentityBirthServiceDeps {
  guards: IdentityGuards;
  ledger: IdentityLedgerWriter;
  rows: PrismaIdentityNewbornRepository;
  /** The address lock (ADR-116 §6): the entrance and the verification
   *  ceremony contend on one constraint, not on two reads. */
  reservations: IdentityReservationRepository;
  /** The write gate's cached answers for this user, dropped once their rows
   *  commit — injected rather than imported so the sequence stays testable
   *  without a module-level cache. */
  forgetGate: (args: { userId: string }) => void;
}

/**
 * The born-finalized entrance (ADR-116 §3): the idempotent sequence a
 * flagged sign-up runs, so a brand-new user's FIRST write is already on the
 * identity branch instead of on the legacy one they would then have to be
 * migrated off.
 *
 * ## Why this is not `IdentityService.attachIdentifier`
 *
 * Because the row writes have to sit in the MIDDLE. The ledger's ordering —
 * stage, wait — is right for every ceremony whose user already exists; here
 * the user does not, and the sign-up must fail before any row exists if the
 * engine cannot take the facts at all. So this sequences the ledger's two
 * legs around its own transaction rather than calling `commit`.
 *
 * The guards still run, unchanged, and they are what makes a retry cost
 * nothing: a fact the heads already carry is not stated again.
 *
 * ## The AccountCredential row
 *
 * ADR-116 §3 lists it among the transaction's row writes. better-auth makes
 * that impossible to honour literally: it creates the user and the credential
 * account in two separate adapter calls, and `databaseHooks.user.create.after`
 * runs between them — the application's own hook writes `OrganizationUser`
 * rows that FK to the user. Deferring the user row past its create would
 * break that hook. So the credential row is written by the account create
 * that follows, on the identity branch, routed there by the request marker
 * this entrance sets. Both rows still exist when sign-up returns, which is
 * what the spec pins.
 *
 * The sequence itself is documented on `bear`, and the id derivation on
 * `claimAddress`.
 */
export class IdentityBirthService implements IdentityBirthPort {
  constructor(private readonly deps: IdentityBirthServiceDeps) {}

  /**
   * ## The legs, and why each is where it is
   *
   *   0. the pinned id must be FREE, and the CLAIM. An entrance that dies
   *      between the staging and the row commit leaves facts under a tenant
   *      with no user row and no projection — nothing serves them, and nothing
   *      could FIND them either, since the event store enumerates no
   *      aggregates. The claim is the handle the reconciliation sweep needs.
   *   1. the idempotent command, STAGED. Engine down means the sign-up fails
   *      loudly here, before any row exists on either branch.
   *   2. ONE Postgres transaction: the user row and the `finalized`
   *      migration-state row.
   *   3. the bounded wait on the fold — so the `Identifier` row is there when
   *      sign-up returns.
   *
   * Nothing after leg two can fail the sign-up. Once the transaction commits
   * the user is real and `finalized`, and a throw from the observation that
   * follows would leave a user who can never sign in and whom no pass owns:
   * the runner skips terminal tenants and the sweep hunts tenants with no user
   * row. The wait is an observation, so it is treated as one.
   */
  async bear({ row, email, createdAtMs }: IdentityNewborn): Promise<Record<string, unknown>> {
    const normalizedValue = normalizeIdentifierValue(email);
    const userId = deriveNewbornUserId({ normalizedValue });
    const command = this.attachCommand({ userId, email, createdAtMs });
    const staged = { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command };

    const occupant = await this.deps.rows.findUserAtPinnedId({ userId });
    if (occupant !== null) {
      throw new IdentityEmailInUseError(
        "born_finalized: the address this sign-up normalizes to already has a user",
      );
    }

    await this.deps.rows.claim({ userId });

    const facts = await this.deps.guards.attachIdentifier(command);
    const events = identityEventsFor({ command: staged, facts });
    if (events.length > 0) {
      await this.claimAddress({ userId, normalizedValue, facts, command });
      try {
        await this.deps.ledger.stage({ command: staged });
      } catch (error) {
        // Never a silent fall back to the legacy branch: a test user quietly
        // born on the old path would poison the very rollout the flag exists
        // to run.
        throw new IdentityEngineUnavailableError(
          "the born-finalized entrance could not hand the newborn's identity facts to the engine",
          error,
        );
      }
    }

    const written = await this.deps.rows.commitNewborn({ userId, user: row });
    // The rows are committed, so the two cached answers that are now wrong
    // get dropped — above all the anyone-finalized short-circuit, which may
    // hold a fleet-wide `false` from before any user was finalized and would
    // otherwise keep this pod off the identity branch for a whole TTL.
    this.deps.forgetGate({ userId });

    if (events.length > 0) await this.observeFold({ userId, command, events });

    logger.info(
      { userId, identifiers: events.length },
      "a flagged sign-up was born finalized on the identity branch",
    );
    return written;
  }

  /**
   * The address lock, taken before the facts reach the engine (ADR-116 §6).
   *
   * ## Ids, and why they are pinned
   *
   * A retry is a fresh request: better-auth mints a new random user id, and
   * with it a new tenant, a new command and a new identifier. So every id here
   * is derived instead. The user id comes from the normalized address; the
   * command id is the one the BACKFILL would use for this user's `User.email`,
   * which means the entrance and any later adoption pass state the same
   * command and the event store dedupes rather than duplicating.
   *
   * The pinned id is a convergence key for a RETRY of this birth, never a
   * claim on a user who already exists. Normalization strips plus-tags, so
   * `sam+anything@acme.com` derives the id `sam@acme.com` was born under — and
   * adopting whatever row sits there would hand the second signer a session as
   * the first. An occupied id is refused outright, before any fact is stated,
   * which is also the honest answer: that address already has an account.
   *
   * The entrance and the verification ceremony contend on ONE constraint,
   * which is what makes the pinned-id check above a fast path rather than the
   * decision: two sign-ups for one normalized address can both read a free id
   * and only one may have it. The birth's identifier arrives ATTACHED, but the
   * user row it is about to write carries the address as `User.email`, so the
   * claim is real from the moment the row lands.
   */
  private async claimAddress({
    userId,
    normalizedValue,
    facts,
    command,
  }: {
    userId: string;
    normalizedValue: string;
    facts: IdentityFactInput[];
    command: AttachIdentifierCommandData;
  }): Promise<void> {
    const attached = facts.find((fact) => fact.type === IDENTIFIER_ATTACHED_EVENT_TYPE);
    if (attached === undefined) return;
    const holder = await this.deps.reservations.claim({
      normalizedValue,
      userId,
      identifierId: attached.data.identifierId,
      commandId: command.commandId,
    });
    if (holder.userId === userId || holder.commandId === command.commandId) {
      return;
    }
    throw new IdentityEmailInUseError(
      "born_finalized: another user holds the lock on this address",
    );
  }

  /**
   * The read-your-writes wait, and the reason it can never fail the sign-up:
   * the user row is already committed and `finalized`, so a throw here would
   * leave a user nothing owns — the migration runner skips terminal tenants
   * and the sweep hunts claims with no user behind them.
   */
  private async observeFold({
    userId,
    command,
    events,
  }: {
    userId: string;
    command: AttachIdentifierCommandData;
    events: IdentityEvent[];
  }): Promise<void> {
    try {
      await this.deps.ledger.awaitFold({
        userId,
        tenantId: command.tenantId,
        events,
      });
    } catch (error) {
      logger.warn(
        { userId, error },
        "could not observe the newborn's fold; the command is queued and the projection converges",
      );
    }
  }

  /**
   * The email identifier `User.email` implies — the same one
   * `planIdentifiers` derives when the backfill adopts an existing user, so
   * the two converge on one projection row rather than two.
   */
  private attachCommand({
    userId,
    email,
    createdAtMs,
  }: {
    userId: string;
    email: string;
    createdAtMs: number;
  }): AttachIdentifierCommandData {
    return attachIdentifierCommandDataSchema.parse({
      tenantId: userId,
      userId,
      commandId: adoptUserEmailCommandId({ userId }),
      accountId: null,
      provider: "email",
      providerId: null,
      // No protocol row backs the address adopted from `User.email`, so
      // nobody asserted it and there is no issuer to name.
      issuer: null,
      providerAccountId: null,
      value: email,
      occurredAtMs: createdAtMs,
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
  }
}
