// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  AgentRegistrySettingsRepository,
  DEFAULT_DORMANT_AFTER_DAYS,
} from "../agent-registry-settings.repository.ts";

type AgentRegistrySettingsDatabase = Pick<PrismaClient, "agentRegistrySettings">;

export class PrismaAgentRegistrySettingsRepository extends AgentRegistrySettingsRepository {
  private constructor(private readonly prisma: AgentRegistrySettingsDatabase) {
    super();
  }

  static create(database: AgentRegistrySettingsDatabase): PrismaAgentRegistrySettingsRepository {
    return new PrismaAgentRegistrySettingsRepository(database);
  }

  async getDormantAfterDays({ organizationId }: { organizationId: string }): Promise<number> {
    const row = await this.prisma.agentRegistrySettings.findUnique({
      where: { organizationId },
      select: { dormantAfterDays: true },
    });
    return row?.dormantAfterDays ?? DEFAULT_DORMANT_AFTER_DAYS;
  }

  async saveDormantAfterDays({
    organizationId,
    days,
  }: {
    organizationId: string;
    days: number;
  }): Promise<void> {
    await this.prisma.agentRegistrySettings.upsert({
      where: { organizationId },
      create: { organizationId, dormantAfterDays: days },
      update: { dormantAfterDays: days },
    });
  }
}
