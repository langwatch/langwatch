import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  InvalidSlackConnectionInputError,
  SLACK_WEBHOOK_MESSAGE,
  SlackConnectionInUseError,
  SlackIntegrationInvalidTokenError,
  SlackIntegrationMissingError,
  defaultSlackConnectionName,
  isSlackWebhookUrl,
  slackSecretHint,
  type SlackConnectionDeleted,
  type SlackConnectionKind,
  type SlackConnectionList,
  type SlackConnectionScopeType,
  type SlackConnectionSecret,
  type SlackConnectionView,
  type SlackManagedConnection,
} from "@langwatch/slack-contract";

import {
  isSlackTransportFailure,
  type SlackWebApiChannel,
  type SlackWorkspaceIdentity,
} from "../channels/slack-web-api.channel.ts";
import type { SlackConnectionClaimRepository } from "../repositories/slack-connection-claim.repository.ts";
import type {
  SlackConnectionChanges,
  SlackConnectionRecord,
  SlackConnectionRow,
  SlackConnectionRepository,
} from "../repositories/slack-connection.repository.ts";
import {
  assertReachableScope,
  connectionSecret,
  heldSecretIdentity,
  isUsableBy,
  secretFields,
  secretIdentity,
  targetScope,
  toView,
  type SlackProjectScope,
} from "../rules/slack-connection.rules.ts";
import { slackSecretFingerprint } from "../rules/slack-secret-fingerprint.rules.ts";
import { SlackConnectionAccessService } from "./slack-connection-access.service.ts";
import { SlackSecretHolderService } from "./slack-secret-holder.service.ts";

/** A secret's stored form: ciphertext, fingerprint, hint and Slack workspace. */
type StoredSecret = Pick<
  SlackConnectionRecord,
  "botToken" | "webhookUrl" | "secretFingerprint" | "secretHint" | "slackTeamId" | "slackTeamName"
>;

/** The repositories, peer slices, channel and keys the service is composed from. */
type SlackConnectionServiceDeps = Readonly<{
  connections: SlackConnectionRepository;
  claims: SlackConnectionClaimRepository;
  projects: Pick<ProjectApi, "listNamesByIds">;
  organizations: Pick<OrganizationApi, "getSettings">;
  authorization: Pick<AuthzApi, "hasPermission">;
  webApi: SlackWebApiChannel;
  fingerprintKey: string;
  /** The key a rotation retired: it finds a stored fingerprint, and none is written under it. */
  previousFingerprintKey?: string | undefined;
}>;

/**
 * Named Slack connections (ADR-093 §5a): a bot token or incoming webhook per
 * organization or project scope. One secret is one connection per scope, a bot
 * token is checked with Slack before it is stored, and no secret is returned.
 */
export class SlackConnectionService {
  private readonly access: SlackConnectionAccessService;
  private readonly holders: SlackSecretHolderService;

  private constructor(private readonly deps: SlackConnectionServiceDeps) {
    this.access = SlackConnectionAccessService.create(deps);
    this.holders = SlackSecretHolderService.create(deps);
  }

  static create(deps: SlackConnectionServiceDeps): SlackConnectionService {
    return new SlackConnectionService(deps);
  }

  /** The project's organization and names, read from their owners. */
  async getProjectScope({ projectId }: { projectId: string }): Promise<SlackProjectScope> {
    const [project] = await this.deps.projects.listNamesByIds({ projectIds: [projectId] });
    if (!project) throw new Error(`project ${projectId} resolves to no organization`);
    const organization = await this.deps.organizations.getSettings({
      organizationId: project.organizationId,
    });
    return {
      projectId: project.id,
      projectName: project.name,
      organizationId: organization.id,
      organizationName: organization.name,
    };
  }

  async listSlackConnections({
    projectId,
    actorId,
  }: {
    projectId: string;
    actorId?: string;
  }): Promise<SlackConnectionList> {
    const scope = await this.getProjectScope({ projectId });
    const rows = await this.deps.connections.findAllUsableByProject({
      organizationId: scope.organizationId,
      projectId,
    });
    const counts = await this.countClaims({
      organizationId: scope.organizationId,
      ids: rows.map((row) => row.id),
    });
    const [canManageProject, canManageOrganization] =
      actorId === undefined
        ? [false, false]
        : await Promise.all([
            this.deps.authorization.hasPermission({
              userId: actorId,
              permission: "project:update",
              projectId,
            }),
            this.deps.authorization.hasPermission({
              userId: actorId,
              permission: "organization:manage",
              organizationId: scope.organizationId,
            }),
          ]);
    return {
      connections: rows.map((row) => ({
        ...toView({ row, scope, dependentAutomations: counts.get(row.id) ?? 0 }),
        canManage: row.scopeType === "ORGANIZATION" ? canManageOrganization : canManageProject,
      })),
      canManageProject,
      canManageOrganization,
    };
  }

  /** A connection the project may use, or `slack_integration_missing`. */
  async getUsableRow({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<{ connection: SlackConnectionRow; scope: SlackProjectScope }> {
    const scope = await this.getProjectScope({ projectId });
    const [connection] = await this.deps.connections.findById({ id });
    if (!connection || !isUsableBy({ connection, scope })) throw new SlackIntegrationMissingError();
    return { connection, scope };
  }

  async getUsableSlackConnection(input: {
    id: string;
    projectId: string;
  }): Promise<SlackConnectionView> {
    const { connection, scope } = await this.getUsableRow(input);
    const counts = await this.countClaims({
      organizationId: connection.organizationId,
      ids: [connection.id],
    });
    return toView({ row: connection, scope, dependentAutomations: counts.get(connection.id) ?? 0 });
  }

  async createSlackConnection({
    projectId,
    actorId,
    name,
    kind,
    scopeType,
    scopeId,
    secret,
  }: {
    projectId: string;
    actorId: string;
    name: string;
    kind: SlackConnectionKind;
    scopeType: SlackConnectionScopeType;
    scopeId: string;
    secret: string;
  }): Promise<SlackManagedConnection> {
    const scope = await this.getProjectScope({ projectId });
    const target = { scopeType, scopeId };
    assertReachableScope({ scope, target });
    await this.access.assertManage({ actorId, target });
    const stored = await this.storedSecret({ kind, secret: secret.trim() });
    const guard = {
      organizationId: scope.organizationId,
      target,
      identity: secretIdentity({ secret, ...this.keys() }),
    };
    await this.holders.assertSecretFree(guard);
    const [row] = await this.deps.connections.create({
      record: {
        name: name.trim(),
        kind,
        scopeType,
        scopeId,
        organizationId: scope.organizationId,
        ...stored,
      },
      actorId,
    });
    if (!row) {
      await this.holders.assertSecretFree(guard);
      throw new Error("Slack connection create lost a race it cannot name");
    }
    return { ...toView({ row, scope, dependentAutomations: 0 }), canManage: true };
  }

  /**
   * Rename, move or replace the secret. An absent secret keeps the stored one;
   * narrowing to one project other projects rely on needs `force`.
   */
  async updateSlackConnection({
    projectId,
    actorId,
    id,
    name,
    scopeType,
    scopeId,
    secret,
    force = false,
  }: {
    projectId: string;
    actorId: string;
    id: string;
    name?: string;
    scopeType?: SlackConnectionScopeType;
    scopeId?: string;
    secret?: string;
    force?: boolean;
  }): Promise<SlackManagedConnection> {
    const { connection, scope } = await this.getUsableRow({ id, projectId });
    await this.access.assertManage({ actorId, target: connection });
    const target = targetScope({ connection, scope, scopeType, scopeId });
    const moves =
      target.scopeType !== connection.scopeType || target.scopeId !== connection.scopeId;
    if (moves) {
      assertReachableScope({ scope, target });
      await this.access.assertManage({ actorId, target });
    }
    const value = secret?.trim();
    if (
      value !== undefined &&
      connection.kind === "INCOMING_WEBHOOK" &&
      !isSlackWebhookUrl(value)
    ) {
      throw new InvalidSlackConnectionInputError(SLACK_WEBHOOK_MESSAGE, "secret");
    }

    const changes: SlackConnectionChanges = {
      ...(name === undefined ? {} : { name: name.trim() }),
      ...(moves ? target : {}),
      ...(value ? await this.storedSecret({ kind: connection.kind, secret: value }) : {}),
    };
    const guard = {
      organizationId: connection.organizationId,
      target,
      identity: heldSecretIdentity({ connection, replacement: value, ...this.keys() }),
      exceptId: connection.id,
    };
    await this.access.assertNarrowingStrandsNothing({ connection, target, force });
    if (value || moves) await this.holders.assertSecretFree(guard);
    const [row] = await this.deps.connections.update({
      id: connection.id,
      organizationId: connection.organizationId,
      changes,
      actorId,
    });
    if (!row) {
      await this.holders.assertSecretFree(guard);
      throw new Error("Slack connection update lost a race it cannot name");
    }
    const counts = await this.countClaims({ organizationId: row.organizationId, ids: [row.id] });
    return {
      ...toView({ row, scope, dependentAutomations: counts.get(row.id) ?? 0 }),
      canManage: true,
    };
  }

  /** Refused while any claim exists (ARCHITECTURE.md §3); no `force`. */
  async deleteSlackConnection({
    projectId,
    actorId,
    id,
  }: {
    projectId: string;
    actorId: string;
    id: string;
  }): Promise<SlackConnectionDeleted> {
    const { connection } = await this.getUsableRow({ id, projectId });
    await this.access.assertManage({ actorId, target: connection });
    const claims = await this.deps.claims.findByConnections({
      organizationId: connection.organizationId,
      ids: [connection.id],
    });
    if (claims.length > 0) {
      throw new SlackConnectionInUseError({
        dependentAutomations: claims.length,
        claimants: claims.map((claim) => ({ id: claim.claimantId, label: claim.claimantLabel })),
      });
    }
    await this.deps.connections.delete({
      id: connection.id,
      organizationId: connection.organizationId,
    });
    return { deleted: true, dependentAutomations: 0 };
  }

  /**
   * A connection this project can already use holding the secret, else a new
   * project connection. Never widens a scope: another project's copy is left
   * as it is (§5a). A bot token Slack refuses is still stored, named from its hint.
   */
  async findOrCreateSlackConnectionForSecret({
    organizationId,
    projectId,
    kind,
    secret,
    actorId,
  }: {
    organizationId: string;
    projectId: string;
    kind: SlackConnectionKind;
    secret: string;
    actorId: string;
  }): Promise<{ id: string; wasCreated: boolean }> {
    const value = secret.trim();
    const held = secretIdentity({ secret: value, ...this.keys() });
    const secretFingerprint = held.current;
    const reach = { organizationId, projectId, identity: held };
    const [existing] = await this.holders.findReachableHolders(reach);
    if (existing) return { id: existing.id, wasCreated: false };

    const verified =
      kind === "BOT" ? await this.deps.webApi.fetchWorkspaceIdentity({ token: value }) : undefined;
    const identity = verified?.ok ? verified.identity : undefined;
    const [row] = await this.deps.connections.create({
      record: {
        name: identity?.teamName ?? defaultSlackConnectionName({ kind, secret: value }),
        kind,
        scopeType: "PROJECT",
        scopeId: projectId,
        organizationId,
        ...secretFields({ kind, secret: value }),
        secretFingerprint,
        secretHint: slackSecretHint({ secret: value }),
        slackTeamId: identity?.teamId ?? null,
        slackTeamName: identity?.teamName ?? null,
      },
      actorId,
    });
    if (row) return { id: row.id, wasCreated: true };

    // Lost a race to a concurrent save of this secret into this project.
    const [raced] = await this.holders.findReachableHolders(reach);
    if (!raced) throw new Error("Slack connection create lost a race");
    return { id: raced.id, wasCreated: false };
  }

  /** The dispatch reader: the decrypted secret, or none when out of reach. */
  async findUsableSlackSecret({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<SlackConnectionSecret[]> {
    const [connection] = await this.deps.connections.findById({ id });
    if (!connection) return [];
    if (!(await this.access.reaches({ connection, projectId }))) return [];
    return connectionSecret({ connection });
  }

  /** Claim counts per connection id (absent = none), all but `exceptProjectId`'s. */
  private keys(): { key: string; previousKey: string | undefined } {
    return { key: this.deps.fingerprintKey, previousKey: this.deps.previousFingerprintKey };
  }

  private async countClaims(input: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const claim of await this.deps.claims.findByConnections(input)) {
      counts.set(claim.connectionId, (counts.get(claim.connectionId) ?? 0) + 1);
    }
    return counts;
  }

  /** A typed secret's stored form; a bot token must be accepted by Slack first. */
  private async storedSecret({
    kind,
    secret,
  }: {
    kind: SlackConnectionKind;
    secret: string;
  }): Promise<StoredSecret> {
    const identity = kind === "BOT" ? [await this.verifyBotToken({ token: secret })] : [];
    return {
      ...secretFields({ kind, secret }),
      secretFingerprint: slackSecretFingerprint({ secret, key: this.deps.fingerprintKey }),
      secretHint: slackSecretHint({ secret }),
      slackTeamId: identity[0]?.teamId ?? null,
      slackTeamName: identity[0]?.teamName ?? null,
    };
  }

  /**
   * Slack must accept a bot token before it is stored. A transport failure is
   * infrastructure, not a refusal, so it stays a plain Error (ADR-045).
   */
  private async verifyBotToken({ token }: { token: string }): Promise<SlackWorkspaceIdentity> {
    // A local slug, not "invalid_auth": Slack never saw this request.
    if (!token) throw new SlackIntegrationInvalidTokenError("empty_token");
    const verified = await this.deps.webApi.fetchWorkspaceIdentity({ token });
    if (verified.ok) return verified.identity;
    if (isSlackTransportFailure(verified.error)) {
      throw new Error(`Slack auth.test did not answer usably: ${verified.error}`);
    }
    throw new SlackIntegrationInvalidTokenError(verified.error);
  }
}
