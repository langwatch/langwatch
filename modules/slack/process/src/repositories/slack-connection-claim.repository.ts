/** One automation holding one connection in use (ARCHITECTURE.md §3, the claims ruling). */
export interface SlackConnectionClaimRow {
  connectionId: string;
  claimantId: string;
  claimantLabel: string;
  organizationId: string;
  projectId: string;
}

/** Slack's own record of who uses a connection; slack never reads automation's triggers. */
export abstract class SlackConnectionClaimRepository {
  /** Idempotent on (connectionId, claimantId); a repeat refreshes the label. */
  abstract upsert(input: SlackConnectionClaimRow): Promise<void>;

  /** Deleting nothing is fine. */
  abstract delete(input: {
    connectionId: string;
    claimantId: string;
    projectId: string;
  }): Promise<void>;

  /** The claims on each of `ids`, all but `exceptProjectId`'s when given. */
  abstract findByConnections(input: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }): Promise<SlackConnectionClaimRow[]>;
}
