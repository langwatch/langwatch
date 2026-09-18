import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { TraceExportRateLimitedError } from "@langwatch/trace-contract";

/**
 * A held slot outlives its export for ten minutes at most: the TTL is the
 * crash safety that frees a slot whose process died mid-stream, the
 * stream's own `finally` is only the prompt release.
 */
const SLOT_TTL_SECONDS = 600;

/** The two commands one export slot is claimed and freed with. */
export interface TraceExportSlotStore {
  /** Claims the key for `expirySeconds` when it is free; false when already held. */
  claim(key: string, value: string, expirySeconds: number): Promise<boolean>;
  del(key: string): Promise<number>;
}

/** The ioredis `SET key value EX seconds NX` call one slot claim is built from. */
export type TraceExportSlotSet = (
  key: string,
  value: string,
  expiryToken: "EX",
  expirySeconds: number,
  claimToken: "NX",
) => Promise<"OK" | null>;

/** One held in-flight slot. `release` is idempotent because DEL is. */
export interface TraceExportSlot {
  release(): Promise<void>;
}

/** The tier-effective ceilings the export download door runs under. */
export interface TraceExportBounds {
  /** Counts one export against the project's per-minute window. */
  assertExportWithinRate(input: { projectId: string }): Promise<void>;
  /** Takes one of the project's in-flight slots, or refuses when all are held. */
  acquireExportSlot(input: { projectId: string; exportId: string }): Promise<TraceExportSlot>;
}

/**
 * The export download's budget: a full-project scan is the project's spend,
 * so both counters bucket by project, at the tier the project's organization
 * resolves through the entitlement peer.
 */
export class TraceExportBoundsService implements TraceExportBounds {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimiter: RateLimiter;
    redis: TraceExportSlotStore;
  }): TraceExportBoundsService {
    return new TraceExportBoundsService(deps);
  }

  /** The composition's own path: the slot store over the process's Redis connection. */
  static createOverRedis(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
    rateLimiter: RateLimiter;
    redis: { set: TraceExportSlotSet; del(key: string): Promise<number> };
  }): TraceExportBoundsService {
    const redis = deps.redis;

    return TraceExportBoundsService.create({
      ...deps,
      redis: {
        claim: async (key, value, expirySeconds) =>
          (await redis.set(key, value, "EX", expirySeconds, "NX")) === "OK",
        del: (key) => redis.del(key),
      },
    });
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimiter: RateLimiter;
      redis: TraceExportSlotStore;
    }>,
  ) {}

  async assertExportWithinRate(input: { projectId: string }): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const requests = await this.deps.entitlement.requestBound({
      key: "exportPerMinute",
      organizationId,
    });
    const decision = await this.deps.rateLimiter.check(`trace-export:${input.projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new TraceExportRateLimitedError({
        reason: "rate",
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  }

  async acquireExportSlot(input: {
    projectId: string;
    exportId: string;
  }): Promise<TraceExportSlot> {
    const organizationId = await this.deps.projects.getOrganizationId(input.projectId);

    const slots = await this.deps.entitlement.requestBound({
      key: "exportConcurrencyPerProject",
      organizationId,
    });
    for (let index = 0; index < slots; index += 1) {
      const key = `trace-export:slot:${input.projectId}:${index}`;
      const claimed = await this.deps.redis.claim(key, input.exportId, SLOT_TTL_SECONDS);
      if (claimed) {
        return {
          release: async () => {
            await this.deps.redis.del(key);
          },
        };
      }
    }

    throw new TraceExportRateLimitedError({ reason: "concurrency" });
  }
}
