// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentRegistrySettingsRepository,
  DEFAULT_DORMANT_AFTER_DAYS,
} from "../agent-registry-settings.repository.ts";

export class MemoryAgentRegistrySettingsRepository extends AgentRegistrySettingsRepository {
  private readonly dormantAfterDays = new Map<string, number>();

  private constructor() {
    super();
  }

  static create(): MemoryAgentRegistrySettingsRepository {
    return new MemoryAgentRegistrySettingsRepository();
  }

  async getDormantAfterDays({ organizationId }: { organizationId: string }): Promise<number> {
    return this.dormantAfterDays.get(organizationId) ?? DEFAULT_DORMANT_AFTER_DAYS;
  }

  async saveDormantAfterDays({
    organizationId,
    days,
  }: {
    organizationId: string;
    days: number;
  }): Promise<void> {
    this.dormantAfterDays.set(organizationId, days);
  }
}
