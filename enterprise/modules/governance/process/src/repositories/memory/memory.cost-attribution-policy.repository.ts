// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { CostAttributionPolicyRepository } from "../cost-attribution-policy.repository.ts";

/** The cost-attribution twin: enabled coding-assistant tile configs per organization. */
export class MemoryCostAttributionPolicyRepository extends CostAttributionPolicyRepository {
  private readonly configs = new Map<string, unknown[]>();

  private constructor() {
    super();
  }

  static create({
    seed = [],
  }: {
    seed?: readonly { organizationId: string; config: unknown }[];
  } = {}): MemoryCostAttributionPolicyRepository {
    const repository = new MemoryCostAttributionPolicyRepository();
    for (const { organizationId, config } of seed) {
      repository.configs.set(organizationId, [
        ...(repository.configs.get(organizationId) ?? []),
        config,
      ]);
    }
    return repository;
  }

  async enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]> {
    return this.configs.get(organizationId) ?? [];
  }
}
