/**
 * The `Idempotency-Key` receipt ledger, composed once for this process.
 *
 * ONE ledger, and that is the whole decision this module makes. The claim, its
 * heartbeat and its takeover window are a protocol BETWEEN concurrent
 * requests, so two ledgers over the same `IdempotencyReceipt` table would give
 * one deployment two takeover clocks racing each other's claims — which is
 * exactly the double create the header exists to prevent. Every family that
 * accepts the header on this process is handed this runner.
 *
 * The protocol itself is `@langwatch/api/rest`'s {@link IdempotencyLedger},
 * moved there from the retired application. What is decided HERE is what a
 * process owns: which receipt store it runs on, and which cipher the stored
 * response body is written under.
 *
 * ## Why the cipher is required rather than optional
 *
 * Two of the keyed creates answer with a secret kept nowhere else in readable
 * form — a virtual key's secret and a webhook endpoint's signing secret are
 * shown once and stored only as a hash — and replaying those responses is the
 * whole point of a key on those routes. So the response body transits the
 * receipt table, and a ledger composed without a cipher would write those
 * secrets to a column in the clear. A deployment with no `CREDENTIALS_SECRET`
 * therefore composes NO ledger: the keyed creates refuse by name, which is the
 * behaviour the absence already had.
 */
import {
  IdempotencyLedger,
  type IdempotencyReceiptPersistence,
  type IdempotencyResponseCipher,
  type IdempotentRunner,
} from "@langwatch/api/rest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import { ApiGatewayIdempotencyPort } from "./api-gateway.composition";

export type ApiIdempotencyCompositionOptions = Readonly<{
  /** The one guarded connection this process's receipts are claimed on. */
  database: PrismaClient | undefined;
  /**
   * The stored-secret cipher this process composed, or none.
   *
   * The SAME cipher every other at-rest secret on this process is written
   * under, so a receipt written here is readable by anything else that holds
   * the key — and unreadable, exactly once, after a rotation, which the ledger
   * treats as an expired receipt rather than as a failure the caller has to
   * understand.
   */
  encryption: SecretEncryptionPort | undefined;
}>;

/** What this composition opened, for the doors that dispatch through it. */
export type ApiIdempotencyComposition = Readonly<{
  /** The runner every keyed create on this process dispatches through. */
  run: IdempotentRunner;
  /** The same runner, as the gateway composition's port declares it. */
  gateway: ApiGatewayIdempotencyPort;
}>;

/** The gateway composition's port, over this process's one ledger. */
class ApiGatewayIdempotencyLedger extends ApiGatewayIdempotencyPort {
  static create(run: IdempotentRunner): ApiGatewayIdempotencyLedger {
    return new ApiGatewayIdempotencyLedger(run);
  }

  private constructor(readonly run: IdempotentRunner) {
    super();
  }
}

/**
 * Composes the ledger where this process holds both halves of it.
 *
 * `undefined` where it holds either alone. A process with no database has
 * nowhere to claim a key, and one with no cipher would store a customer's
 * one-time secret in the clear; in both cases the keyed creates refuse by
 * name, which is strictly better than accepting a key they cannot honour.
 */
export function composeApiIdempotency(
  options: ApiIdempotencyCompositionOptions,
): ApiIdempotencyComposition | undefined {
  const { database, encryption } = options;
  if (!database || !encryption) return undefined;

  const ledger = IdempotencyLedger.create({
    // The generated client's `idempotencyReceipt` delegate satisfies the
    // ledger's structural store: the table carries every column the protocol
    // reads and the unique index over (scopeId, key) it decides on.
    receipts: database satisfies IdempotencyReceiptPersistence,
    cipher: encryption satisfies IdempotencyResponseCipher,
  });

  return { run: ledger.run, gateway: ApiGatewayIdempotencyLedger.create(ledger.run) };
}
