// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { CostAttributionPolicyRepository } from "../cost-attribution-policy.repository.ts";

/** The cost-attribution twin: enabled coding-assistant tile configs per organization. */
export class MemoryCostAttributionPolicyRepository extends CostAttributionPolicyRepository {
  private readonly configs = new Map<string, unknown[]>();

  private constructor() {
    super();
  }

  static create(): MemoryCostAttributionPolicyRepository {
    return new MemoryCostAttributionPolicyRepository();
  }

  async enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]> {
    return this.configs.get(organizationId) ?? [];
  }

  addEnabledCodingAssistantConfig(input: { organizationId: string; config: unknown }): void {
    this.configs.set(input.organizationId, [
      ...(this.configs.get(input.organizationId) ?? []),
      input.config,
    ]);
  }
}
