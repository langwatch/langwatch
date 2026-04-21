import type {
  TriggerRepository,
  TriggerSummary,
} from "./repositories/trigger.repository";

export class TriggerService {
  private readonly cache = new Map<
    string,
    { triggers: TriggerSummary[]; expiresAt: number }
  >();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly repo: TriggerRepository) {}

  async getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const cached = this.cache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.triggers;
    }

    const all = await this.repo.findActiveForProject(projectId);
    const traceOnly = all.filter((t) => !t.customGraphId);

    this.cache.set(projectId, {
      triggers: traceOnly,
      expiresAt: Date.now() + TriggerService.TTL_MS,
    });

    return traceOnly;
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId);
  }
}
