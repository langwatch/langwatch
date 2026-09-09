import {
  IdentityEmailService as IdentityEmailCapability,
  type MatchableEmail,
  matchableEmailsOf,
  primaryEmailOf,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { IdentityHeadsReader } from "../repositories/identity-heads.repository.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

const logger = createLogger("langwatch:identity:email");

/**
 * The READ fork for `User.email` (ADR-101 §5; D03 generalizes it to the
 */
export class IdentityEmailService extends IdentityEmailCapability {
  static create(heads: IdentityHeadsReader, isOnIdentity: IdentityUserGate): IdentityEmailService {
    return new IdentityEmailService(heads, isOnIdentity);
  }

  private constructor(
    private readonly heads: IdentityHeadsReader,
    private readonly isOnIdentity: IdentityUserGate,
  ) {
    super();
  }

  /**
   * The user's email according to their identifiers — PRIMARY, else the
   * most recently VERIFIED — or null to keep the legacy column's answer.
   */
  async tryResolveEmail({ userId }: { userId: string }): Promise<string | null> {
    try {
      if (!(await this.isOnIdentity({ userId }))) {
        return null;
      }

      const heads = await this.heads.findHeads({ userId });

      return primaryEmailOf({ heads });
    } catch (error) {
      // A read fork that can break sign-in is worse than a stale email.
      logger.warn(
        { userId, error },
        "could not resolve the identifier email; falling back to the legacy User.email column",
      );

      return null;
    }
  }

  /**
   * Every address the user has PROVEN, through any method — invitation acceptance's question
   * (D11): an invite targets an address, and any VERIFIED identifier holding it vouches for the
   * person.
   */
  async tryVerifiedEmailsOf({ userId }: { userId: string }): Promise<MatchableEmail[] | null> {
    try {
      if (!(await this.isOnIdentity({ userId }))) {
        return null;
      }

      const heads = await this.heads.findHeads({ userId });

      return matchableEmailsOf({ heads });
    } catch (error) {
      logger.warn(
        { userId, error },
        "could not resolve the verified identifier emails; falling back to the legacy User.email column",
      );

      return null;
    }
  }
}
