// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { CostAttributionPolicyRepository } from "../cost-attribution-policy.repository.ts";

/** The cost-attribution twin: enabled coding-assistant tile configs per organization. */
export class MemoryCostAttributionPolicyRepository extends CostAttributionPolicyRepository {
  private readonly configs = new Map<string, { config: unknown; enabled: boolean }[]>();

  private constructor() {
    super();
  }

  static create({
    seed = [],
  }: {
    seed?: readonly { organizationId: string; config: unknown; enabled?: boolean }[];
  } = {}): MemoryCostAttributionPolicyRepository {
    const repository = new MemoryCostAttributionPolicyRepository();
    for (const { organizationId, config, enabled = true } of seed) {
      repository.configs.set(organizationId, [
        ...(repository.configs.get(organizationId) ?? []),
        { config, enabled },
      ]);
    }
    return repository;
  }

  async enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]> {
    return this.enabledConfigs(organizationId);
  }

  async organizationsWithEnabledCodingAssistants(): Promise<string[]> {
    return [...this.configs.keys()].filter((id) => this.enabledConfigs(id).length > 0);
  }

  private enabledConfigs(organizationId: string): unknown[] {
    return (this.configs.get(organizationId) ?? [])
      .filter((entry) => entry.enabled)
      .map((entry) => entry.config);
  }
}
