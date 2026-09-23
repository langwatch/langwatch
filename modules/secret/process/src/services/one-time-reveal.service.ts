/**
 * The one-time reveal: a secret parked under an id and served once, so the id
 * may travel where the value must not.
 * Spec: modules/secret/specs/one-time-reveal.feature.
 */
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  ONE_TIME_REVEAL_KSUID_RESOURCE,
  ONE_TIME_REVEAL_TTL_MS,
  SecretAlreadyRevealedError,
  SecretRevealExpiredError,
  type RevealedSecret,
  type RevealOnceInput,
  type StashedReveal,
  type StashRevealInput,
} from "@langwatch/secret-contract";

import type { SecretEncryption } from "../app/secret.app.ts";
import type { OneTimeRevealRepository } from "../repositories/one-time-reveal.repository.ts";

const logger = createLogger("langwatch:secret:one-time-reveal");

export interface OneTimeRevealDeps {
  store: OneTimeRevealRepository;
  /** The process's own cipher: the reveal is sealed at rest, so a store dump
   *  is not a list of plaintext credentials. */
  encryption: SecretEncryption;
  ttlMs?: number;
}

export class OneTimeRevealService {
  static create(deps: OneTimeRevealDeps): OneTimeRevealService {
    return new OneTimeRevealService(deps);
  }

  private constructor(private readonly deps: OneTimeRevealDeps) {}

  /** Parks the secret and answers the id that reads it once. */
  async stash(input: StashRevealInput): Promise<StashedReveal> {
    const revealId = generate(ONE_TIME_REVEAL_KSUID_RESOURCE).toString();
    await this.deps.store.put({
      organizationId: input.organizationId,
      revealId,
      reveal: {
        kind: input.kind,
        keyId: input.keyId,
        preview: input.preview,
        sealed: this.deps.encryption.encrypt(input.secret),
      },
      ttlMs: this.ttlMs,
    });
    logger.info(
      { organizationId: input.organizationId, kind: input.kind, keyId: input.keyId },
      "Stashed a secret for a one-time reveal",
    );
    return { revealId };
  }

  /**
   * Serves the secret and forgets it. A second read of the same id is refused
   * as already revealed; an id with nothing behind it - expired, never
   * stashed, or another organization's - is refused as expired.
   */
  async reveal({ organizationId, revealId }: RevealOnceInput): Promise<RevealedSecret> {
    const taken = await this.deps.store.take({ organizationId, revealId });
    if (!taken.taken) {
      const served = await this.deps.store.wasServed({ organizationId, revealId });
      throw served
        ? new SecretAlreadyRevealedError(revealId)
        : new SecretRevealExpiredError(revealId);
    }

    const stored = taken.reveal;
    await this.deps.store.markServed({ organizationId, revealId, ttlMs: this.ttlMs });
    logger.info(
      { organizationId, kind: stored.kind, keyId: stored.keyId },
      "Served a one-time reveal",
    );
    return {
      kind: stored.kind,
      keyId: stored.keyId,
      preview: stored.preview,
      secret: this.deps.encryption.decrypt(stored.sealed),
    };
  }

  private get ttlMs(): number {
    return this.deps.ttlMs ?? ONE_TIME_REVEAL_TTL_MS;
  }
}
