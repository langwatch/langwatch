/**
 * The managed gateway key of a license, on Prisma (ADR-139).
 *
 * The key is an ordinary VirtualKey with `purpose: CONNECT`, so budgets, spend
 * rows, the change feed and revocation work as they do for any gateway key. Its
 * secret is dropped as soon as it is minted: the license token is the
 * credential, and the key is only ever reached through the registry.
 */

import { ensureHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import type { ConnectManagedKeyPort } from "./licenseRegistry.service";

const CONNECT_TEAM_NAME = "Hosted services";

export class PrismaConnectManagedKeys implements ConnectManagedKeyPort {
  constructor(private readonly prisma: PrismaClient) {}

  async provision({
    organizationId,
    licenseId,
  }: {
    organizationId: string;
    licenseId: string;
  }): Promise<{ id: string }> {
    await this.ensureTeam(organizationId);
    // Hosted-service spend lands on the organization's hidden project, the
    // same home organization-scoped gateway keys already use. It is named
    // here because an organization with projects of its own would otherwise
    // be refused as ambiguous.
    const home = await ensureHiddenGovernanceProject(
      this.prisma,
      organizationId,
    );
    const { virtualKey } = await VirtualKeyService.create(this.prisma).create({
      organizationId,
      name: `Connect ${licenseId}`,
      description:
        "Managed key for the hosted services of a self-hosted license.",
      principalUserId: null,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      traceProjectId: home.id,
      actorUserId: SYSTEM_ACTORS.connectLicense,
      purpose: "CONNECT",
    });
    return { id: virtualKey.id };
  }

  async retire({
    virtualKeyId,
    organizationId,
    actorId,
  }: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void> {
    await VirtualKeyService.create(this.prisma).revokeManagedInternal({
      id: virtualKeyId,
      organizationId,
      actorUserId: actorId,
    });
  }

  async invalidate({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<void> {
    await VirtualKeyService.create(this.prisma).invalidateManagedInternal({
      id: virtualKeyId,
      organizationId,
    });
  }

  /**
   * A customer organization created from the backoffice has no team, and a
   * project needs one. The slug is derived from the organization, so two
   * concurrent first calls collide on it and the second reads the first's row.
   */
  private async ensureTeam(organizationId: string): Promise<void> {
    const existing = await this.prisma.team.findFirst({
      where: { organizationId },
      select: { id: true },
    });
    if (existing) return;
    try {
      await this.prisma.team.create({
        data: {
          name: CONNECT_TEAM_NAME,
          slug: `connect-${organizationId}`.toLowerCase(),
          organizationId,
        },
      });
    } catch (error) {
      const lostRace =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!lostRace) throw error;
    }
  }
}
