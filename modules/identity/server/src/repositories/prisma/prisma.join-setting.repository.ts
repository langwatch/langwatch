import { DEFAULT_DOMAIN_JOIN_SETTING, type DomainJoinSetting } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { JoinSettingPort } from "../../rules/join-requests-contract.rules.ts";
import { PrismaJoinCandidateRepository } from "./prisma.join-request.repository.ts";

/**
 * The organization's joining setting, as two plain columns. Not event-sourced,
 * on purpose: it is configuration an administrator sets, like every other
 * organization setting, and the thing that needs a history is the requests it
 * produces rather than the switch itself.
 */
export class PrismaJoinSettingRepository implements JoinSettingPort {
  static create(prisma: PrismaClient): PrismaJoinSettingRepository {
    return new PrismaJoinSettingRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async read({ organizationId }: { organizationId: string }): Promise<{
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { domainJoin: true, joinDomains: true },
    });

    return {
      domainJoin: row
        ? PrismaJoinCandidateRepository.readDomainJoin(row.domainJoin)
        : DEFAULT_DOMAIN_JOIN_SETTING,
      joinDomains: row?.joinDomains ?? [],
    };
  }

  async write({
    organizationId,
    domainJoin,
    joinDomains,
  }: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { domainJoin, joinDomains },
    });
  }
}
