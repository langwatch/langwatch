import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { credentialsSecret, credentialsSecretPrevious, sessionSecret } from "@langwatch/secrets";
import {
  SlackApi,
  type SlackApi as SlackApiContract,
  type SlackConnectionClaimant,
  type SlackConnectionClaimPage,
  type SlackConnectionDeleted,
  type SlackConnectionKind,
  type SlackConnectionList,
  type SlackConnectionScopeType,
  type SlackConnectionSecret,
  type SlackConnectionView,
  type SlackManagedConnection,
  slackConfig,
  type SlackServerConfig,
} from "@langwatch/slack-contract";

import type { SlackChannels } from "../channels/slack.channels.ts";
import type { SlackRepositories } from "../repositories/slack.repositories.ts";
import { SlackConnectionClaimService } from "../services/slack-connection-claim.service.ts";
import { SlackConnectionService } from "../services/slack-connection.service.ts";

type SlackSetup = FeatureSetup<
  typeof SlackModule.dependencies,
  SlackServerConfig,
  SlackRepositories,
  SlackChannels
>;

/** A project's Slack connections and their claims; services carry the weight. */
export class SlackModule implements SlackApiContract {
  static readonly contract = SlackApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    authorization: AuthzApi,
  };
  static readonly config = slackConfig;
  static readonly secrets = {
    /** Main's fingerprint key: CREDENTIALS_SECRET, else NEXTAUTH_SECRET. */
    fingerprintKey: credentialsSecret,
    fingerprintKeyFallback: sessionSecret,
    /** The key a rotation retired: it finds a stored fingerprint, and none is written under it. */
    fingerprintKeyPrevious: credentialsSecretPrevious,
  } as const;

  readonly #connections: SlackConnectionService;
  readonly #claims: SlackConnectionClaimService;

  private constructor(parts: {
    connections: SlackConnectionService;
    claims: SlackConnectionClaimService;
  }) {
    this.#connections = parts.connections;
    this.#claims = parts.claims;
  }

  static async create({
    dependencies,
    repositories,
    channels,
    secrets,
  }: SlackSetup): Promise<SlackModule> {
    const fingerprintKey =
      (await secrets.into(SlackModule.secrets.fingerprintKey, (value) => value ?? "")) ||
      (await secrets.into(SlackModule.secrets.fingerprintKeyFallback, (value) => value ?? ""));
    const previousFingerprintKey = await secrets.into(
      SlackModule.secrets.fingerprintKeyPrevious,
      (previous) => previous || void 0,
    );
    const connections = SlackConnectionService.create({
      connections: repositories.connections,
      claims: repositories.claims,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      authorization: dependencies.authorization,
      webApi: channels.webApi,
      fingerprintKey,
      previousFingerprintKey,
    });
    return new SlackModule({
      connections,
      claims: SlackConnectionClaimService.create({ claims: repositories.claims, connections }),
    });
  }

  listSlackConnections(input: {
    projectId: string;
    actorId?: string;
  }): Promise<SlackConnectionList> {
    return this.#connections.listSlackConnections(input);
  }

  createSlackConnection(input: {
    projectId: string;
    actorId: string;
    name: string;
    kind: SlackConnectionKind;
    scopeType: SlackConnectionScopeType;
    scopeId: string;
    secret: string;
  }): Promise<SlackManagedConnection> {
    return this.#connections.createSlackConnection(input);
  }

  updateSlackConnection(input: {
    projectId: string;
    actorId: string;
    id: string;
    name?: string;
    scopeType?: SlackConnectionScopeType;
    scopeId?: string;
    secret?: string;
    force?: boolean;
  }): Promise<SlackManagedConnection> {
    return this.#connections.updateSlackConnection(input);
  }

  deleteSlackConnection(input: {
    projectId: string;
    actorId: string;
    id: string;
  }): Promise<SlackConnectionDeleted> {
    return this.#connections.deleteSlackConnection(input);
  }

  getUsableSlackConnection(input: { id: string; projectId: string }): Promise<SlackConnectionView> {
    return this.#connections.getUsableSlackConnection(input);
  }

  findUsableSlackSecret(input: {
    id: string;
    projectId: string;
  }): Promise<SlackConnectionSecret[]> {
    return this.#connections.findUsableSlackSecret(input);
  }

  findOrCreateSlackConnectionForSecret(input: {
    organizationId: string;
    projectId: string;
    kind: SlackConnectionKind;
    secret: string;
    actorId: string;
  }): Promise<{ id: string; wasCreated: boolean }> {
    return this.#connections.findOrCreateSlackConnectionForSecret(input);
  }

  claimConnection(input: {
    connectionId: string;
    projectId: string;
    claimant: SlackConnectionClaimant;
  }): Promise<void> {
    return this.#claims.claimConnection(input);
  }

  releaseConnection(input: {
    connectionId: string;
    projectId: string;
    claimantId: string;
  }): Promise<void> {
    return this.#claims.releaseConnection(input);
  }

  listSlackConnectionClaims(input: {
    after?: string;
    limit?: number;
  }): Promise<SlackConnectionClaimPage> {
    return this.#claims.listSlackConnectionClaims(input);
  }
}
