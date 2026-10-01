import {
  SlackConnectionClaimRepository,
  type SlackConnectionClaimRow,
} from "../slack-connection-claim.repository.ts";

const claimKey = ({ connectionId, claimantId }: { connectionId: string; claimantId: string }) =>
  `${connectionId}\u0000${claimantId}`;

/** The memory tier of `slack_connection_claim`, keyed as its primary key is. */
export class MemorySlackConnectionClaimRepository extends SlackConnectionClaimRepository {
  readonly #claims = new Map<string, SlackConnectionClaimRow>();

  static create(): MemorySlackConnectionClaimRepository {
    return new MemorySlackConnectionClaimRepository();
  }

  upsert(claim: SlackConnectionClaimRow): Promise<void> {
    const current = this.#claims.get(claimKey(claim));
    this.#claims.set(claimKey(claim), {
      ...(current ?? claim),
      claimantLabel: claim.claimantLabel,
      projectId: claim.projectId,
    });
    return Promise.resolve();
  }

  delete(input: { connectionId: string; claimantId: string; projectId: string }): Promise<void> {
    if (this.#claims.get(claimKey(input))?.projectId === input.projectId) {
      this.#claims.delete(claimKey(input));
    }
    return Promise.resolve();
  }

  findByConnections({
    organizationId,
    ids,
    exceptProjectId,
  }: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }): Promise<SlackConnectionClaimRow[]> {
    const wanted = new Set(ids);
    const claims = [...this.#claims.values()].filter(
      (claim) =>
        claim.organizationId === organizationId &&
        wanted.has(claim.connectionId) &&
        claim.projectId !== exceptProjectId,
    );
    return Promise.resolve(claims.map((claim) => ({ ...claim })));
  }
}
