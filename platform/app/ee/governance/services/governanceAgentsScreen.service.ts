// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Agents screen's read, composed once on the server.
 *
 * The screen shows one list built from two tables that never meet: agents
 * registered from code (ADR-128) and agents a provider was asked to list. The
 * page previously fetched neither and stood on an empty state, because
 * `agents.getAll` is project-scoped and this section is organization-scoped.
 *
 * The join rules and every "we have not measured this" decision live in
 * `logic/agentInventoryRows.ts`, so they can be held down by a test that needs
 * no datastore. What is left here is the three reads and the clock.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { createLogger } from "@langwatch/observability";

import type { GovernanceAgentRow } from "~/components/governance/agents/agentRows";
import type { PrismaClient } from "~/generated/prisma/client";

import { OrganizationConnectedAgentRepository } from "../repositories/governanceAgentInventory.repository";
import {
  DiscoveredAgentRepository,
  OrganizationAccountDirectoryRepository,
} from "../repositories/governanceIdentity.repository";
import { buildAgentInventory } from "./logic/agentInventoryRows";

const logger = createLogger("langwatch:governance:agents-screen");

export class GovernanceAgentsScreenService {
  private readonly prisma: PrismaClient;
  private readonly registered = new OrganizationConnectedAgentRepository();
  private readonly discovered = new DiscoveredAgentRepository();
  private readonly accounts = new OrganizationAccountDirectoryRepository();

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
  }

  static create(prisma: PrismaClient): GovernanceAgentsScreenService {
    return new GovernanceAgentsScreenService({ prisma });
  }

  /**
   * Every agent the organization has, from both origins.
   *
   * `now` is a parameter so a test states the instant its "days ago" figures
   * are measured from, rather than racing the clock.
   */
  async listAgents({
    organizationId,
    now = new Date(),
  }: {
    organizationId: string;
    now?: Date;
  }): Promise<GovernanceAgentRow[]> {
    const [registered, discovered, memberNames] = await Promise.all([
      this.registered.listByOrganization(this.prisma, { organizationId, now }),
      this.discovered.listByOrganization(this.prisma, { organizationId }),
      this.accounts.findMemberNames(this.prisma, { organizationId }),
    ]);

    const inventory = buildAgentInventory({
      registered,
      discovered,
      memberNames,
      now,
    });

    if (inventory.unknownProviders.length > 0) {
      // Not silent, because the only way to reach this is to teach a source
      // type to list agents without giving the page a chip for it, and the
      // symptom is agents quietly missing from an inventory.
      logger.warn(
        { organizationId, providers: inventory.unknownProviders },
        "discovered agents came from a provider the agents page has no source chip for; they are not listed",
      );
    }

    return inventory.rows;
  }
}
