import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { credentialsSecret, sessionSecret } from "@langwatch/secrets";
import {
  SlackApi,
  type SlackApi as SlackApiContract,
  type SlackConnectionClaimant,
  type SlackConnectionDeleted,
  type SlackConnectionKind,
  type SlackConnectionList,
  type SlackConnectionScopeType,
  type SlackConnectionSecret,
  type SlackConnectionView,
  type SlackManagedConnection,
} from "@langwatch/slack-contract";

import { HttpSlackWebApiChannel } from "../channels/http/http.slack-web-api.channel.ts";
import { MemorySlackWebApiChannel } from "../channels/memory/memory.slack-web-api.channel.ts";
import type { SlackRepositories } from "../repositories/slack.repositories.ts";
import { SlackConnectionClaimService } from "../services/slack-connection-claim.service.ts";
import { SlackConnectionService } from "../services/slack-connection.service.ts";

const slackReads = ["encryption"] as const;

type SlackSetup = FeatureSetup<
  typeof SlackApp.dependencies,
  MembersRead<typeof slackReads>,
  undefined,
  SlackRepositories
>;

/** A project's Slack connections and their claims; services carry the weight. */
export class SlackApp implements SlackApiContract {
  static readonly contract = SlackApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    authorization: AuthzApi,
  };
  static readonly reads = slackReads;
  static readonly secrets = {
    /** Main's fingerprint key: CREDENTIALS_SECRET, else NEXTAUTH_SECRET. */
    fingerprintKey: credentialsSecret,
    fingerprintKeyFallback: sessionSecret,
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
    members,
    repositories,
    secrets,
    tier,
  }: SlackSetup): Promise<SlackApp> {
    const fingerprintKey =
      (await secrets.into(SlackApp.secrets.fingerprintKey, (value) => value ?? "")) ||
      (await secrets.into(SlackApp.secrets.fingerprintKeyFallback, (value) => value ?? ""));
    const connections = SlackConnectionService.create({
      connections: repositories.connections,
      claims: repositories.claims,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      authorization: dependencies.authorization,
      webApi:
        tier === "memory" ? MemorySlackWebApiChannel.create() : HttpSlackWebApiChannel.create(),
      cipher: members.encryption,
      fingerprintKey,
    });
    return new SlackApp({
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
}
