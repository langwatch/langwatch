// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX,
  AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN,
  type AgentRegistrySettings,
  GovernanceValidationError,
} from "@langwatch/enterprise-governance-contract";

import type { AgentRegistrySettingsRepository } from "../../../repositories/agent-registry-settings.repository.ts";

type AgentRegistrySettingsDependencies = {
  settings: AgentRegistrySettingsRepository;
};

/**
 * The organisation's registry settings: the dormancy window the next reconcile applies.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
export class AgentRegistrySettingsService {
  private constructor(private readonly deps: AgentRegistrySettingsDependencies) {}

  static create(deps: AgentRegistrySettingsDependencies): AgentRegistrySettingsService {
    return new AgentRegistrySettingsService(deps);
  }

  async get({ organizationId }: { organizationId: string }): Promise<AgentRegistrySettings> {
    return {
      dormant_after_days: await this.deps.settings.getDormantAfterDays({ organizationId }),
    };
  }

  async save({
    organizationId,
    dormantAfterDays,
  }: {
    organizationId: string;
    dormantAfterDays: number;
  }): Promise<AgentRegistrySettings> {
    if (
      !Number.isInteger(dormantAfterDays) ||
      dormantAfterDays < AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN ||
      dormantAfterDays > AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX
    ) {
      const complaint = `dormant_after_days must be a whole number from ${AGENT_REGISTRY_DORMANT_AFTER_DAYS_MIN} to ${AGENT_REGISTRY_DORMANT_AFTER_DAYS_MAX}`;
      throw new GovernanceValidationError("The dormancy window is out of range.", {
        formErrors: [],
        fieldErrors: { dormant_after_days: [complaint] },
      });
    }
    await this.deps.settings.saveDormantAfterDays({ organizationId, days: dormantAfterDays });
    return { dormant_after_days: dormantAfterDays };
  }
}
