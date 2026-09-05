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
import {
  IdentityEngineUnavailableError,
  type IdentityBirthPort,
  type IdentityNewborn,
} from "../better-auth/identity-birth";
import { createLogger } from "@langwatch/observability";
import type { IdentityEvent } from "../projections/identity-state.projection";
import { IdentityStateFoldProjection } from "../projections/identity-state.projection";
import type { IdentityBirthLedgerPort } from "../ports/identity-birth-ledger.port";
import type { IdentityNewbornRepository } from "../identity-newborn.repository";

const logger = createLogger("langwatch:identity:birth");

export interface IdentityBirthServiceDeps {
  guards: IdentityGuards;
  ledger: IdentityBirthLedgerPort;
  rows: IdentityNewbornRepository;
  /** The address lock (ADR-116 §6): the entrance and the verification
   *  ceremony contend on one constraint, not on two reads. */
  reservations: IdentityReservationRepository;
  /** The write gate's cached answers for this user, dropped once their rows
   *  commit — injected rather than imported so the sequence stays testable
   *  without a module-level cache. */
  forgetGate: (args: { userId: string }) => void;
}

/**
 * flagged sign-up runs,
 * The born-finalized entrance (ADR-116 §3): the idempotent sequence a
 * ADR-116 §3 lists it among the transaction's row writes. better-auth makes
 */
export class IdentityBirthService implements IdentityBirthPort {
  static create(deps: IdentityBirthServiceDeps): IdentityBirthService {
    return new IdentityBirthService(deps);
  }

  private constructor(private readonly deps: IdentityBirthServiceDeps) {}

  /**
   * ## The legs, and why each is where it is 0. the pinned id must be FREE, and the CLAIM.
   */
  async bear({ row, email, createdAtMs }: IdentityNewborn): Promise<Record<string, unknown>> {
    const normalizedValue = normalizeIdentifierValue(email);
    const userId = deriveNewbornUserId({ normalizedValue });
    const command = this.attachCommand({ userId, email, createdAtMs });
    const staged = { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command };

    const occupant = await this.deps.rows.tryFindUserAtPinnedId({ userId });
    if (occupant !== null) {
      throw new IdentityEmailInUseError(
        "born_finalized: the address this sign-up normalizes to already has a user",
      );
    }

    await this.deps.rows.claim({ userId });

    const facts = await this.deps.guards.attachIdentifier(command);
    const events = IdentityStateFoldProjection.eventsFor({ command: staged, facts });
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

    if (events.length > 0) {
      await this.observeFold({ userId, command, events });
    }

    logger.info(
      { userId, identifiers: events.length },
      "a flagged sign-up was born finalized on the identity branch",
    );

    return written;
  }

  /**
   * ## Ids, and why they are pinned A retry is a fresh request: better-auth mints a new random user
   * id, and with it a new tenant, a new command and a new identifier.
   * The address lock, taken before the facts reach the engine (ADR-116 §6).
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
    if (attached === undefined) {
      return;
    }

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
   * The read-your-writes wait, and the reason it can never fail the sign-up: the user row is
   * already committed and `finalized`, so a throw here would leave a user nothing owns — the
   * migration runner skips terminal tenants and the sweep hunts claims with no user behind them.
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
