import type { PullResult, PullRunOptions } from "@langwatch/enterprise-governance-contract";

export interface RegisteredGovernancePuller {
  readonly id: string;
  validateConfig(config: unknown): unknown;
  runOnce(options: PullRunOptions, config: unknown): Promise<PullResult>;
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

  getById(adapterId: string): RegisteredGovernancePuller {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Unknown ingestion pull adapter: ${adapterId}`);
    }

    return adapter;
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }

  clear(): void {
    this.adapters.clear();
  }
}
