import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

import type { Prisma, PrismaClient } from "~/generated/prisma/client";

export interface DiscoveredAgentInput {
  organizationId: string;
  providerConnectionId: string;
  /**
   * The provider's own labels for this agent, joined per adapter — Copilot
   * Studio's is `environmentId/botId`, because a bot id is only unique inside
   * an environment. Whatever the adapter joins, it must be stable across
   * pulls: this value IS the recognition rule.
   */
  providerAgentKey: string;
  /**
   * Provider-side state: display name, owner, quarantined, whatever the
   * inventory call returned. It is what the PROVIDER says, never our status —
   * nothing in here decides whether an agent is approved (ADR-094 Decision 8).
   */
  snapshot?: Prisma.InputJsonValue;
}

/**
 * The inventory of bots and agents seen in a customer's providers (ADR-094
 * Decision 8).
 *
 * Each agent gets OUR id, which everything else references and which survives
 * a rename at the provider forever. Recognising it again on the next pull is
 * the uniqueness rule itself — insert, catch the duplicate, reuse the row —
 * and NOT a lookup followed by an insert. A lookup can drift: two workers
 * pulling the same connection both find nothing and both insert, which is the
 * sync-drift bug class the ADR rejects by name. The database decides.
 */
export class DiscoveredAgentService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): DiscoveredAgentService {
    return new DiscoveredAgentService(prisma);
  }

  /**
   * Record one agent an adapter saw, returning our stable id for it. Safe to
   * call on every pull: the same provider labels always resolve to the same
   * row, and only the snapshot moves.
   */
  async record(input: DiscoveredAgentInput): Promise<{ id: string }> {
    const { organizationId, providerConnectionId, providerAgentKey, snapshot } =
      input;

    try {
      const created = await this.prisma.discoveredAgent.create({
        data: {
          organizationId,
          providerConnectionId,
          providerAgentKey,
          ...(snapshot === undefined ? {} : { snapshot }),
        },
        select: { id: true },
      });
      return created;
    } catch (error) {
      if (
        !(error instanceof PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
    }

    // Seen before. The row keeps its id — a rename at the provider changes
    // what the snapshot says, never which row this is.
    const existing = await this.prisma.discoveredAgent.update({
      where: {
        organizationId_providerConnectionId_providerAgentKey: {
          organizationId,
          providerConnectionId,
          providerAgentKey,
        },
      },
      data: snapshot === undefined ? {} : { snapshot },
      select: { id: true },
    });
    return existing;
  }
}
