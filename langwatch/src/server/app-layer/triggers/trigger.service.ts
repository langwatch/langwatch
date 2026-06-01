import { generate as ksuid } from "@langwatch/ksuid";
import type { Trigger } from "@prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { TtlCache } from "~/server/utils/ttlCache";
import type {
  TriggerRepository,
  TriggerSummary,
  TriggerUpsertInput,
} from "./repositories/trigger.repository";

export class TriggerService {
  private static readonly TTL_MS = 60_000;

  private readonly cache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "triggers:",
  );

  constructor(private readonly repo: TriggerRepository) {}

  async getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const cached = await this.cache.get(projectId);
    if (cached) return cached;

    const all = await this.repo.findActiveForProject(projectId);
    const traceOnly = all.filter((t) => !t.customGraphId);

    await this.cache.set(projectId, traceOnly);

    return traceOnly;
  }

  /**
   * Atomically claim (triggerId, traceId). Returns true on first claim,
   * false if another reactor already claimed it. Side effects (email,
   * slack, dataset write) must run only when this returns true to avoid
   * double-fire on concurrent dispatch or reactor retry.
   */
  async claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.claimSend(params);
  }

  async updateLastRunAt(
    triggerId: string,
    projectId: string,
  ): Promise<void> {
    return this.repo.updateLastRunAt(triggerId, projectId);
  }

  /**
   * Authoring counterpart to the runtime methods above. Validation guards
   * (template syntax, action params, license enforcement) belong upstream —
   * this method assumes the payload has already cleared them and is
   * responsible only for the persistence shape + cache invalidation. A
   * KSUID is minted here on create so callers don't reach for an id
   * generator of their own.
   */
  async upsertTrigger(params: {
    projectId: string;
    triggerId: string | null;
    data: TriggerUpsertInput;
  }): Promise<Trigger> {
    const trigger = params.triggerId
      ? await this.repo.update({
          triggerId: params.triggerId,
          projectId: params.projectId,
          data: params.data,
        })
      : await this.repo.create({
          id: ksuid(KSUID_RESOURCES.TRIGGER).toString(),
          projectId: params.projectId,
          data: params.data,
        });

    await this.invalidate(params.projectId);
    return trigger;
  }

  async invalidate(projectId: string): Promise<void> {
    await this.cache.delete(projectId);
  }
}
