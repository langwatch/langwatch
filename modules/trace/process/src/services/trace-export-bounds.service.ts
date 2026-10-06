import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { TraceExportRateLimitedError } from "@langwatch/trace-contract";

import type { TraceExportSlotRepository } from "../repositories/trace-export-slot.repository.ts";
import type { TraceRateLimitRepository } from "../repositories/trace-rate-limit.repository.ts";

/**
 * A held slot outlives its export for ten minutes at most: the TTL is the
 * crash safety that frees a slot whose process died mid-stream, the
 * stream's own `finally` is only the prompt release.
 */
const SLOT_TTL_SECONDS = 600;

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
    rateLimiter: TraceRateLimitRepository;
    slots: TraceExportSlotRepository;
  }): TraceExportBoundsService {
    return new TraceExportBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
      rateLimiter: TraceRateLimitRepository;
      slots: TraceExportSlotRepository;
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
      const claimed = await this.deps.slots.claim(key, input.exportId, SLOT_TTL_SECONDS);
      if (claimed) {
        return {
          release: async () => {
            await this.deps.slots.del(key);
          },
        };
      }
    }

    throw new TraceExportRateLimitedError({ reason: "concurrency" });
  }
}
