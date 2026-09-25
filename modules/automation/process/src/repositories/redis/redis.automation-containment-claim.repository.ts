import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import {
  AutomationContainmentClaimRepository,
  CONTAINMENT_CLAIM_KSUID_RESOURCE,
  CONTAINMENT_CLAIM_TTL_SECONDS,
} from "../automation-containment-claim.repository.ts";
import type { ClaimLease } from "../automation-runaway.repository.ts";
import { MemoryAutomationContainmentClaimRepository } from "../memory/memory.automation-containment-claim.repository.ts";

const RELEASE_IF_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Unreachable Redis still contains: once per pod rather than not at all. */
const perPodFallback = MemoryAutomationContainmentClaimRepository.create();

/** Fleet-wide claims in Redis, falling back to this pod's own when Redis errors. */
export class RedisAutomationContainmentClaimRepository extends AutomationContainmentClaimRepository {
  static create(input: {
    connection: Pick<RedisConnection, "set" | "eval">;
    logger?: Pick<Logger, "warn">;
  }): RedisAutomationContainmentClaimRepository {
    return new RedisAutomationContainmentClaimRepository(
      input.connection,
      input.logger ?? createLogger("langwatch:automation:runaway-containment"),
    );
  }

  private constructor(
    private readonly connection: Pick<RedisConnection, "set" | "eval">,
    private readonly logger: Pick<Logger, "warn">,
  ) {
    super();
  }

  async claimOnce(
    key: string,
    ttlSeconds = CONTAINMENT_CLAIM_TTL_SECONDS,
  ): Promise<ClaimLease | "already-claimed"> {
    const token = generate(CONTAINMENT_CLAIM_KSUID_RESOURCE).toString();
    try {
      const taken = await this.connection.set(key, token, "EX", ttlSeconds, "NX");

      return taken !== null ? { key, token } : "already-claimed";
    } catch (error) {
      this.logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error claiming an automation containment notification; falling back to a per-worker claim",
      );
    }

    return perPodFallback.claimOnce(key, ttlSeconds);
  }

  async releaseClaim(lease: ClaimLease): Promise<void> {
    try {
      await this.connection.eval(RELEASE_IF_OWNED_SCRIPT, 1, lease.key, lease.token);
    } catch (error) {
      this.logger.warn(
        { key: lease.key, error: error instanceof Error ? error.message : String(error) },
        "Redis error releasing an automation containment claim; the fleet keeps it until expiry",
      );
    }
    await perPodFallback.releaseClaim(lease);
  }
}
