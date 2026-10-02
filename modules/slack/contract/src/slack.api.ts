import { moduleApi } from "@langwatch/module";

import type {
  SlackConnectionClaimant,
  SlackConnectionDeleted,
  SlackConnectionKind,
  SlackConnectionList,
  SlackConnectionScopeType,
  SlackConnectionSecret,
  SlackConnectionView,
  SlackManagedConnection,
} from "./slack.schemas.ts";

/** A project's Slack connections and the claims automations hold on them (ARCHITECTURE.md §3). */
export interface SlackApi {
  /** Main's `slackIntegration.list`; with no `actorId` (an API key) nothing reads as manageable. */
  listSlackConnections(input: {
    projectId: string;
    actorId?: string;
  }): Promise<SlackConnectionList>;
  createSlackConnection(input: {
    projectId: string;
    actorId: string;
    name: string;
    kind: SlackConnectionKind;
    scopeType: SlackConnectionScopeType;
    scopeId: string;
    secret: string;
  }): Promise<SlackManagedConnection>;
  updateSlackConnection(input: {
    projectId: string;
    actorId: string;
    id: string;
    name?: string;
    scopeType?: SlackConnectionScopeType;
    scopeId?: string;
    secret?: string;
    force?: boolean;
  }): Promise<SlackManagedConnection>;
  /** Refused with `slack_connection_in_use` while any claim exists. */
  deleteSlackConnection(input: {
    projectId: string;
    actorId: string;
    id: string;
  }): Promise<SlackConnectionDeleted>;
  /** Main's `getUsableByProject`: throws `slack_integration_missing` when out of reach. */
  getUsableSlackConnection(input: { id: string; projectId: string }): Promise<SlackConnectionView>;
  /** Main's `findUsableSecret`: zero or one decrypted secret. */
  findUsableSlackSecret(input: { id: string; projectId: string }): Promise<SlackConnectionSecret[]>;
  findOrCreateSlackConnectionForSecret(input: {
    organizationId: string;
    projectId: string;
    kind: SlackConnectionKind;
    secret: string;
    actorId: string;
  }): Promise<{ id: string; wasCreated: boolean }>;
  /** Idempotent on (connectionId, claimant.id); refreshes the label. */
  claimConnection(input: {
    connectionId: string;
    projectId: string;
    claimant: SlackConnectionClaimant;
  }): Promise<void>;
  /** Idempotent: releasing nothing is fine. */
  releaseConnection(input: {
    connectionId: string;
    projectId: string;
    claimantId: string;
  }): Promise<void>;
}

export const SlackApi = moduleApi<SlackApi>()("slack");
