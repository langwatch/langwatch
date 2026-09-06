import type { LangyDatabase } from "./prisma.langy-database";
import { PrismaLangySessionKeyReapRepository } from "./prisma.langy-session-key-reap.repository";
import {
  LangySessionKeyRepository,
  type LangySessionKeyRecord,
} from "../langy-session-key.repository";

export class PrismaLangySessionKeyRepository extends LangySessionKeyRepository {
  private constructor(
    private readonly database: LangyDatabase,
    private readonly reap: PrismaLangySessionKeyReapRepository,
  ) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangySessionKeyRepository {
    return new PrismaLangySessionKeyRepository(
      database,
      PrismaLangySessionKeyReapRepository.create(database),
    );
  }

  async tryFindProjectScope(projectId: string): Promise<{
    teamId: string;
    organizationId: string;
  } | null> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project?.team) return null;

    return {
      teamId: project.teamId,
      organizationId: project.team.organizationId,
    };
  }

  async tryFindById(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRecord | null> {
    const key = await this.database.apiKey.findUnique({
      where: { id: input.apiKeyId },
      select: {
        id: true,
        name: true,
        revokedAt: true,
        roleBindings: {
          where: { scopeType: "PROJECT", scopeId: input.projectId },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!key) return null;

    return {
      id: key.id,
      name: key.name,
      revokedAt: key.revokedAt,
      isScopedToProject: key.roleBindings.length > 0,
    };
  }

  async revoke(apiKeyId: string, revokedAt: Date): Promise<void> {
    await this.database.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt },
    });
  }

  /** Delegated so the App's repository and a worker's narrow one run the identical UPDATE. */
  revokeExpiredByName(input: { name: string; now: Date }): Promise<number> {
    return this.reap.revokeExpiredByName(input);
  }

  /** Same sweep, positional args, for the App's tenancy-guard suite call shape. */
  reapExpired(revokedAt: Date, name: string): Promise<number> {
    return this.revokeExpiredByName({ name, now: revokedAt });
  }
}
