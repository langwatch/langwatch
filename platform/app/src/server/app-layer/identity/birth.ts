import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import {
  adoptUserEmailCommandId,
  deriveNewbornUserId,
  type IdentityGuards,
} from "@langwatch/identity-server";
import {
  type IdentityBirthPort,
  IdentityEngineUnavailableError,
  type IdentityNewborn,
} from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import { identityEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import type { IdentityLedgerWriter } from "./ledger";
import type { PrismaIdentityNewbornRepository } from "./repositories/identity-newborn.prisma.repository";

const logger = createLogger("langwatch:identity:birth");

export interface IdentityBirthServiceDeps {
  guards: IdentityGuards;
  ledger: IdentityLedgerWriter;
  rows: PrismaIdentityNewbornRepository;
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
 * append, stage, wait — is right for every ceremony whose user already
 * exists; here the user does not, and the fold declines to project one that
 * does not. Staging before the rows commit would return a sign-up whose
 * `Identifier` row is missing. So this sequences the ledger's two legs
 * around its own transaction rather than calling `commit`.
 *
 * The guards still run, unchanged, and they are what makes a retry cost
 * nothing: a fact the heads already carry is not stated again.
 *
 * ## The legs, and why each is where it is
 *
 *   0. the CLAIM, before anything else. An entrance that dies between the
 *      append and the row commit leaves facts under a tenant with no user
 *      row and no projection — nothing serves them, and nothing could FIND
 *      them either, since the event store enumerates no aggregates. The
 *      claim is the handle the reconciliation sweep needs.
 *   1. the waited idempotent APPEND. Engine down means the sign-up fails
 *      loudly here, before any row exists on either branch.
 *   2. ONE Postgres transaction: the user row and the `finalized`
 *      migration-state row.
 *   3. the fold, staged, with the ceremonies' bounded wait — so the
 *      `Identifier` row is there when sign-up returns.
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
 */
export class IdentityBirthService implements IdentityBirthPort {
  constructor(private readonly deps: IdentityBirthServiceDeps) {}

  async bear({
    row,
    email,
    createdAtMs,
  }: IdentityNewborn): Promise<Record<string, unknown>> {
    const normalizedValue = normalizeIdentifierValue(email);
    const userId = deriveNewbornUserId({ normalizedValue });
    const command = this.attachCommand({ userId, email, createdAtMs });

    await this.deps.rows.claim({ userId });

    const facts = await this.deps.guards.attachIdentifier(command);
    const events = identityEventsFor({
      command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command },
      facts,
    });
    if (events.length > 0) {
      try {
        await this.deps.ledger.append({
          command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command },
          events,
        });
      } catch (error) {
        // Never a silent fall back to the legacy branch: a test user quietly
        // born on the old path would poison the very rollout the flag exists
        // to run.
        throw new IdentityEngineUnavailableError(
          "the born-finalized entrance could not append the newborn's identity facts",
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
      await this.deps.ledger.stageAndAwait({
        command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command },
        events,
      });
    }

    logger.info(
      { userId, identifiers: events.length },
      "a flagged sign-up was born finalized on the identity branch",
    );
    return written;
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
      providerAccountId: null,
      value: email,
      occurredAtMs: createdAtMs,
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: userId },
    });
  }
}
