import { Temporal, type Instant } from "@langwatch/time";

import type { AuthzUserStandingRepository } from "../repositories/authz-user-standing.repository.ts";
import type { AuthzPlatformOperatorsService } from "./authz-platform-operators.service.ts";

type StandingFact = Readonly<{ userId: string; occurredAt: number }>;

/**
 * Authz's own record of who is deactivated or erased, kept from user's and identity's facts
 * (ARCHITECTURE.md, "Platform operators are a grant"). Each reaction is idempotent; erasure
 * marks the user gone first, so the erasure revoke of their platform grant is then allowed.
 */
export class AuthzUserStandingService {
  static create(options: {
    standings: AuthzUserStandingRepository;
    platformOperators: Pick<AuthzPlatformOperatorsService, "revokeErased">;
  }): AuthzUserStandingService {
    return new AuthzUserStandingService(options.standings, options.platformOperators);
  }

  private constructor(
    private readonly standings: AuthzUserStandingRepository,
    private readonly platformOperators: Pick<AuthzPlatformOperatorsService, "revokeErased">,
  ) {}

  deactivated({ userId, occurredAt }: StandingFact): Promise<void> {
    return this.standings.recordDeactivated({ userId, at: instantOf(occurredAt) });
  }

  reactivated({ userId, occurredAt }: StandingFact): Promise<void> {
    return this.standings.recordReactivated({ userId, at: instantOf(occurredAt) });
  }

  async erased({ userId, occurredAt }: StandingFact): Promise<void> {
    await this.standings.recordErased({ userId, at: instantOf(occurredAt) });
    await this.platformOperators.revokeErased({ userId });
  }
}

function instantOf(epochMilliseconds: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
}
