import type { SlackConnectionClaimant } from "@langwatch/slack-contract";

import type { SlackConnectionClaimRepository } from "../repositories/slack-connection-claim.repository.ts";
import type { SlackConnectionService } from "./slack-connection.service.ts";

/**
 * Who holds a connection in use (ARCHITECTURE.md §3, the claims ruling):
 * automation claims one when it saves a trigger on it and releases it when the
 * trigger moves off, pauses or is deleted. A claimed connection is never deleted.
 */
export class SlackConnectionClaimService {
  private constructor(
    private readonly deps: Readonly<{
      claims: SlackConnectionClaimRepository;
      connections: Pick<SlackConnectionService, "getUsableRow">;
    }>,
  ) {}

  static create(deps: {
    claims: SlackConnectionClaimRepository;
    connections: Pick<SlackConnectionService, "getUsableRow">;
  }): SlackConnectionClaimService {
    return new SlackConnectionClaimService(deps);
  }

  /** Idempotent; a connection the claimant's project cannot use is `slack_integration_missing`. */
  async claimConnection({
    connectionId,
    projectId,
    claimant,
  }: {
    connectionId: string;
    projectId: string;
    claimant: SlackConnectionClaimant;
  }): Promise<void> {
    const { connection } = await this.deps.connections.getUsableRow({
      id: connectionId,
      projectId,
    });
    await this.deps.claims.upsert({
      connectionId: connection.id,
      claimantId: claimant.id,
      claimantLabel: claimant.label,
      organizationId: connection.organizationId,
      projectId,
    });
  }

  /** Idempotent: releasing nothing is fine. */
  async releaseConnection(input: {
    connectionId: string;
    projectId: string;
    claimantId: string;
  }): Promise<void> {
    await this.deps.claims.delete(input);
  }
}
