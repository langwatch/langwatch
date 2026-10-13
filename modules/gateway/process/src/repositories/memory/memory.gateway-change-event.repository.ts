import type {
  AppendGatewayChangeEventInput,
  GatewayChangeEvent,
  GatewayChangeEventsRepository,
} from "../gateway-change-event.repository.ts";

/** The change feed in memory: one revision sequence across organizations, as the table's. */
export class MemoryGatewayChangeEventsRepository implements GatewayChangeEventsRepository {
  static create(): MemoryGatewayChangeEventsRepository {
    return new MemoryGatewayChangeEventsRepository();
  }

  readonly #events: (GatewayChangeEvent & { organizationId: string; payload: unknown })[] = [];
  #revision = 0n;

  private constructor() {}

  async append(input: AppendGatewayChangeEventInput): Promise<{ revision: bigint }> {
    this.#revision += 1n;
    this.#events.push({
      organizationId: input.organizationId,
      revision: this.#revision,
      kind: input.kind,
      virtualKeyId: input.virtualKeyId ?? null,
      budgetId: input.budgetId ?? null,
      modelProviderId: input.modelProviderId ?? null,
      projectId: input.projectId ?? null,
      payload: input.payload ?? null,
    });

    return { revision: this.#revision };
  }

  async since(
    organizationId: string,
    since: bigint,
    limit = 500,
  ): Promise<{ currentRevision: bigint; events: GatewayChangeEvent[] }> {
    const events = this.#events
      .filter((event) => event.organizationId === organizationId && event.revision > since)
      .slice(0, limit)
      .map(({ revision, kind, virtualKeyId, budgetId, modelProviderId, projectId }) => ({
        revision,
        kind,
        virtualKeyId,
        budgetId,
        modelProviderId,
        projectId,
      }));

    return { currentRevision: events.at(-1)?.revision ?? since, events };
  }

  async currentRevision(organizationId: string): Promise<bigint> {
    const ofOrganization = this.#events.filter((event) => event.organizationId === organizationId);
    return ofOrganization.at(-1)?.revision ?? 0n;
  }
}
