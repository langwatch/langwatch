import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type PresenceProjectSettings,
  PresenceSettingsRepository,
} from "../presence-settings.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaPresenceSettingsDatabase = Pick<PrismaClient, "project">;

/** Project's `Project` and organization's `Team` and `Organization` rows, via shares (R40). */
export class PrismaPresenceSettingsRepository extends PresenceSettingsRepository {
  private constructor(private readonly prisma: PrismaPresenceSettingsDatabase) {
    super();
  }

  static create({
    prisma,
  }: Readonly<{ prisma: PrismaPresenceSettingsDatabase }>): PrismaPresenceSettingsRepository {
    return new PrismaPresenceSettingsRepository(prisma);
  }

  /** One round trip: a heartbeat asks this, so both flags come in a single joined read. */
  async getSettings({ projectId }: { projectId: string }): Promise<PresenceProjectSettings> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        presenceEnabled: true,
        team: { select: { organization: { select: { presenceEnabled: true } } } },
      },
    });
    if (!project) return { outcome: "unknown" };
    return {
      outcome: "known",
      projectEnabled: project.presenceEnabled,
      organizationEnabled: project.team.organization.presenceEnabled,
    };
  }
}
