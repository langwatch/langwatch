export interface RegisteredGovernancePuller {
  readonly id: string;
  validateConfig(config: unknown): unknown;
  runOnce(
    options: {
      cursor: string | null;
      credentials?: Record<string, string>;
      context?: { organizationId: string; ingestionSourceId: string };
      deadlineMs?: number;
      signal?: {
        readonly aborted: boolean;
        readonly reason?: unknown;
      };
    },
    config: unknown,
  ): Promise<{
    events: unknown[];
    cursor: string | null;
    errorCount: number;
  }>;
}

export class PullerRegistryService {
  private readonly adapters = new Map<string, RegisteredGovernancePuller>();

  static create(): PullerRegistryService {
    return new PullerRegistryService();
  }

  register(adapter: RegisteredGovernancePuller): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`PullerAdapter "${adapter.id}" is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(adapterId: string): RegisteredGovernancePuller | undefined {
    return this.adapters.get(adapterId);
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }

  clear(): void {
    this.adapters.clear();
  }
}
