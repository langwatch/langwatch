import { SLACK_BOT_TOKEN_KEPT } from "@langwatch/automations/providers/slack";
import { z } from "zod";
import type {
  SlackIntegration,
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";
import {
  fetchSlackWorkspaceIdentity,
  isSlackTransportFailure,
  type SlackWorkspaceIdentity,
} from "../delivery/slackWebApi";
import {
  InvalidActionParamsError,
  SlackConnectionExistsError,
  SlackConnectionInUseError,
  SlackIntegrationInvalidTokenError,
  SlackIntegrationMissingError,
} from "../errors";
import type {
  SlackConnectionChanges,
  SlackIntegrationRepository,
  SlackProjectScope,
} from "./repositories/slack-integration.repository";
import type {
  SlackConnectionReader,
  SlackConnectionSecret,
} from "./slack-destination-resolver";
import {
  slackSecretFingerprint,
  slackSecretHint,
} from "./slack-secret-fingerprint";

/** What a client may know about a connection. The secret has no field here. */
export interface SlackConnectionView {
  id: string;
  name: string;
  kind: SlackIntegrationKind;
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
  scopeName: string;
  secretHint: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
  dependentAutomations: number;
  updatedAt: Date;
}

type VerifyToken = (
  token: string,
) => Promise<
  { ok: true; identity: SlackWorkspaceIdentity } | { ok: false; error: string }
>;

/** What the public API reads back in place of a credential; never a secret. */
const REDACTED_PLACEHOLDER = "[redacted]";

/** The Slack fields of an automation save, read without a cast. */
const slackSaveFieldsSchema = z.object({
  slackIntegrationId: z.string().nullish(),
  slackDelivery: z.enum(["webhook", "bot"]).nullish(),
  slackWebhook: z.string().nullish(),
  slackBotToken: z.string().nullish(),
  slackChannelId: z.string().nullish(),
});

/** A secret the caller actually typed, as opposed to a kept or read-back value. */
const freshSecret = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === SLACK_BOT_TOKEN_KEPT || trimmed === REDACTED_PLACEHOLDER) {
    return null;
  }
  return trimmed;
};

const defaultName = ({
  kind,
  secret,
}: {
  kind: SlackIntegrationKind;
  secret: string;
}): string =>
  `${kind === "BOT" ? "Slack bot" : "Slack webhook"} ••••${slackSecretHint({ secret })}`;

/**
 * Named Slack connections (ADR-093 §5a): any number per organization, each a
 * bot token or an incoming webhook, scoped to the organization or one project.
 * One secret is one connection per organization; a bot token is checked with
 * Slack before it is stored, and no secret is ever returned to a client.
 */
export class SlackIntegrationService implements SlackConnectionReader {
  constructor(
    private readonly repo: SlackIntegrationRepository,
    private readonly verifyToken: VerifyToken = fetchSlackWorkspaceIdentity,
  ) {}

  /** The project's organization and names. A project with none is corrupt data. */
  async getProjectScope({
    projectId,
  }: {
    projectId: string;
  }): Promise<SlackProjectScope> {
    const scope = await this.repo.findProjectScope({ projectId });
    if (!scope) {
      throw new Error(`project ${projectId} resolves to no organization`);
    }
    return scope;
  }

  async listForProject({ projectId }: { projectId: string }): Promise<{
    scope: SlackProjectScope;
    connections: SlackConnectionView[];
  }> {
    const scope = await this.getProjectScope({ projectId });
    const rows = await this.repo.findAllUsableByProject({
      organizationId: scope.organizationId,
      projectId,
    });
    const counts = await this.repo.countDependentAutomations({
      organizationId: scope.organizationId,
      ids: rows.map((row) => row.id),
    });
    return {
      scope,
      connections: rows.map((row) =>
        this.toView({ row, scope, dependentAutomations: counts.get(row.id) }),
      ),
    };
  }

  /** A connection the project may use, or `slack_integration_missing`. */
  async getUsableByProject({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<{ connection: SlackIntegration; scope: SlackProjectScope }> {
    const scope = await this.getProjectScope({ projectId });
    const connection = await this.repo.findById({ id });
    if (!connection || !isUsableBy({ connection, scope })) {
      throw new SlackIntegrationMissingError();
    }
    return { connection, scope };
  }

  async create({
    scope,
    name,
    kind,
    scopeType,
    scopeId,
    secret,
    actorId,
  }: {
    scope: SlackProjectScope;
    name: string;
    kind: SlackIntegrationKind;
    scopeType: SlackIntegrationScopeType;
    scopeId: string;
    secret: string;
    actorId: string;
  }): Promise<SlackConnectionView> {
    const value = secret.trim();
    const identity =
      kind === "BOT" ? await this.verifyBotToken({ token: value }) : null;
    const secretFingerprint = slackSecretFingerprint({ secret: value });
    await this.assertSecretFree({
      organizationId: scope.organizationId,
      secretFingerprint,
    });
    const row = await this.repo.create({
      record: {
        name: name.trim(),
        kind,
        scopeType,
        scopeId,
        organizationId: scope.organizationId,
        ...encryptedSecret({ kind, secret: value }),
        secretFingerprint,
        secretHint: slackSecretHint({ secret: value }),
        slackTeamId: identity?.teamId ?? null,
        slackTeamName: identity?.teamName ?? null,
      },
      actorId,
    });
    if (!row) {
      await this.assertSecretFree({
        organizationId: scope.organizationId,
        secretFingerprint,
      });
      throw new Error("Slack connection create lost a race it cannot name");
    }
    return this.toView({ row, scope, dependentAutomations: 0 });
  }

  /** Rename, move or replace the secret. An absent secret keeps the stored one. */
  async update({
    scope,
    connection,
    name,
    scopeType,
    scopeId,
    secret,
    actorId,
  }: {
    scope: SlackProjectScope;
    connection: SlackIntegration;
    name?: string;
    scopeType?: SlackIntegrationScopeType;
    scopeId?: string;
    secret?: string;
    actorId: string;
  }): Promise<SlackConnectionView> {
    const changes: SlackConnectionChanges = {
      ...(name === undefined ? {} : { name: name.trim() }),
      ...(scopeType === undefined ? {} : { scopeType }),
      ...(scopeId === undefined ? {} : { scopeId }),
    };
    const value = secret?.trim();
    if (value) {
      const identity =
        connection.kind === "BOT"
          ? await this.verifyBotToken({ token: value })
          : null;
      const secretFingerprint = slackSecretFingerprint({ secret: value });
      await this.assertSecretFree({
        organizationId: connection.organizationId,
        secretFingerprint,
        exceptId: connection.id,
      });
      Object.assign(changes, {
        ...encryptedSecret({ kind: connection.kind, secret: value }),
        secretFingerprint,
        secretHint: slackSecretHint({ secret: value }),
        slackTeamId: identity?.teamId ?? null,
        slackTeamName: identity?.teamName ?? null,
      });
    }
    const row = await this.repo.update({
      id: connection.id,
      organizationId: connection.organizationId,
      changes,
      actorId,
    });
    if (!row) {
      await this.assertSecretFree({
        organizationId: connection.organizationId,
        secretFingerprint: changes.secretFingerprint ?? "",
        exceptId: connection.id,
      });
      throw new Error("Slack connection update lost a race it cannot name");
    }
    const counts = await this.repo.countDependentAutomations({
      organizationId: row.organizationId,
      ids: [row.id],
    });
    return this.toView({
      row,
      scope,
      dependentAutomations: counts.get(row.id),
    });
  }

  /** Refused while active automations use it, unless `force` confirms it. */
  async delete({
    connection,
    force,
  }: {
    connection: SlackIntegration;
    force: boolean;
  }): Promise<{ deleted: true; dependentAutomations: number }> {
    const counts = await this.repo.countDependentAutomations({
      organizationId: connection.organizationId,
      ids: [connection.id],
    });
    const dependentAutomations = counts.get(connection.id) ?? 0;
    if (dependentAutomations > 0 && !force) {
      throw new SlackConnectionInUseError({ dependentAutomations });
    }
    await this.repo.delete({
      id: connection.id,
      organizationId: connection.organizationId,
    });
    return { deleted: true, dependentAutomations };
  }

  /**
   * The connection holding this secret, created project-scoped if there is
   * none. A match scoped to another project widens to the organization: both
   * projects already hold the secret, the same rule as the migration (§5a).
   * A bot token Slack refuses is still stored, named from its hint.
   */
  async findOrCreateForSecret({
    organizationId,
    projectId,
    kind,
    secret,
    actorId,
  }: {
    organizationId: string;
    projectId: string;
    kind: SlackIntegrationKind;
    secret: string;
    actorId: string;
  }): Promise<{ id: string; created: boolean }> {
    const value = secret.trim();
    const secretFingerprint = slackSecretFingerprint({ secret: value });
    const existing = await this.repo.findByFingerprint({
      organizationId,
      secretFingerprint,
    });
    if (existing) {
      await this.widenToOrganization({
        connection: existing,
        projectId,
        actorId,
      });
      return { id: existing.id, created: false };
    }

    const verified = kind === "BOT" ? await this.verifyToken(value) : null;
    const identity = verified?.ok ? verified.identity : null;
    const row = await this.repo.create({
      record: {
        name: identity?.teamName ?? defaultName({ kind, secret: value }),
        kind,
        scopeType: "PROJECT",
        scopeId: projectId,
        organizationId,
        ...encryptedSecret({ kind, secret: value }),
        secretFingerprint,
        secretHint: slackSecretHint({ secret: value }),
        slackTeamId: identity?.teamId ?? null,
        slackTeamName: identity?.teamName ?? null,
      },
      actorId,
    });
    if (row) return { id: row.id, created: true };

    // Lost a race to a concurrent save of the same secret: that row is ours too.
    const raced = await this.repo.findByFingerprint({
      organizationId,
      secretFingerprint,
    });
    if (!raced) throw new Error("Slack connection create lost a race");
    await this.widenToOrganization({ connection: raced, projectId, actorId });
    return { id: raced.id, created: false };
  }

  /** The dispatch reader: the decrypted secret, or null when out of reach. */
  async findUsableSecret({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<SlackConnectionSecret | null> {
    const connection = await this.repo.findById({ id });
    if (!connection) return null;
    if (!(await this.reaches({ connection, projectId }))) return null;
    return decryptedSecret(connection);
  }

  /**
   * The Slack half of an automation save, pointed at a connection: a given id
   * must be usable by the project, and a freshly typed legacy secret is stored
   * as a connection. Either way the delivery method is the connection's kind
   * and no secret stays in the params. A save with neither is left alone.
   */
  async connectActionParams({
    projectId,
    actorId,
    actionParams,
  }: {
    projectId: string;
    actorId: string;
    actionParams: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const fields = slackSaveFieldsSchema.safeParse(actionParams);
    if (!fields.success) return actionParams;
    const connectionId =
      fields.data.slackIntegrationId ??
      (await this.connectLegacySecret({
        projectId,
        actorId,
        fields: fields.data,
      }));
    if (!connectionId) return actionParams;

    const { connection } = await this.getUsableByProject({
      id: connectionId,
      projectId,
    });
    const {
      slackWebhook: _webhook,
      slackBotToken: _token,
      slackBotTokenSet: _tokenSet,
      slackChannelId: _channel,
      ...rest
    } = actionParams;
    if (connection.kind === "INCOMING_WEBHOOK") {
      return {
        ...rest,
        slackIntegrationId: connection.id,
        slackDelivery: "webhook",
      };
    }
    const channel = fields.data.slackChannelId?.trim();
    if (!channel) {
      throw new InvalidActionParamsError(
        "A Slack channel is required for a bot connection.",
        "slackChannelId",
      );
    }
    return {
      ...rest,
      slackIntegrationId: connection.id,
      slackDelivery: "bot",
      slackChannelId: channel,
    };
  }

  /** A freshly typed legacy secret, stored as a connection; null when none. */
  private async connectLegacySecret({
    projectId,
    actorId,
    fields,
  }: {
    projectId: string;
    actorId: string;
    fields: z.infer<typeof slackSaveFieldsSchema>;
  }): Promise<string | null> {
    const kind: SlackIntegrationKind =
      fields.slackDelivery === "bot" ? "BOT" : "INCOMING_WEBHOOK";
    const secret = freshSecret(
      kind === "BOT" ? fields.slackBotToken : fields.slackWebhook,
    );
    if (!secret) return null;
    const scope = await this.getProjectScope({ projectId });
    const { id } = await this.findOrCreateForSecret({
      organizationId: scope.organizationId,
      projectId,
      kind,
      secret,
      actorId,
    });
    return id;
  }

  /** Whether the project may use the connection, reading its scope only if needed. */
  private async reaches({
    connection,
    projectId,
  }: {
    connection: SlackIntegration;
    projectId: string;
  }): Promise<boolean> {
    if (connection.scopeType === "PROJECT") {
      return connection.scopeId === projectId;
    }
    const scope = await this.repo.findProjectScope({ projectId });
    return !!scope && isUsableBy({ connection, scope });
  }

  private async widenToOrganization({
    connection,
    projectId,
    actorId,
  }: {
    connection: SlackIntegration;
    projectId: string;
    actorId: string;
  }): Promise<void> {
    if (
      connection.scopeType !== "PROJECT" ||
      connection.scopeId === projectId
    ) {
      return;
    }
    await this.repo.update({
      id: connection.id,
      organizationId: connection.organizationId,
      changes: {
        scopeType: "ORGANIZATION",
        scopeId: connection.organizationId,
      },
      actorId,
    });
  }

  /**
   * Slack must accept a bot token before it is stored. A transport failure is
   * infrastructure, not a refusal, so it stays a plain Error (ADR-045).
   */
  private async verifyBotToken({
    token,
  }: {
    token: string;
  }): Promise<SlackWorkspaceIdentity> {
    // A local slug, not "invalid_auth": Slack never saw this request.
    if (!token) throw new SlackIntegrationInvalidTokenError("empty_token");
    const verified = await this.verifyToken(token);
    if (verified.ok) return verified.identity;
    if (isSlackTransportFailure(verified.error)) {
      throw new Error(
        `Slack auth.test did not answer usably: ${verified.error}`,
      );
    }
    throw new SlackIntegrationInvalidTokenError(verified.error);
  }

  private async assertSecretFree({
    organizationId,
    secretFingerprint,
    exceptId,
  }: {
    organizationId: string;
    secretFingerprint: string;
    exceptId?: string;
  }): Promise<void> {
    const holder = await this.repo.findByFingerprint({
      organizationId,
      secretFingerprint,
    });
    if (holder && holder.id !== exceptId) {
      throw new SlackConnectionExistsError({
        connectionId: holder.id,
        connectionName: holder.name,
      });
    }
  }

  private toView({
    row,
    scope,
    dependentAutomations,
  }: {
    row: SlackIntegration;
    scope: SlackProjectScope;
    dependentAutomations: number | undefined;
  }): SlackConnectionView {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      scopeName:
        row.scopeType === "ORGANIZATION"
          ? scope.organizationName
          : row.scopeId === scope.projectId
            ? scope.projectName
            : row.scopeId,
      secretHint: row.secretHint,
      slackTeamId: row.slackTeamId,
      slackTeamName: row.slackTeamName,
      dependentAutomations: dependentAutomations ?? 0,
      updatedAt: row.updatedAt,
    };
  }
}

/** Whether the project may deliver through the connection (ADR-093 §5a). */
function isUsableBy({
  connection,
  scope,
}: {
  connection: SlackIntegration;
  scope: SlackProjectScope;
}): boolean {
  if (connection.organizationId !== scope.organizationId) return false;
  return connection.scopeType === "ORGANIZATION"
    ? connection.scopeId === scope.organizationId
    : connection.scopeId === scope.projectId;
}

function decryptedSecret(
  connection: SlackIntegration,
): SlackConnectionSecret | null {
  if (connection.kind === "BOT") {
    return connection.botTokenEncrypted
      ? { kind: "BOT", token: decrypt(connection.botTokenEncrypted) }
      : null;
  }
  return connection.webhookUrlEncrypted
    ? { kind: "INCOMING_WEBHOOK", url: decrypt(connection.webhookUrlEncrypted) }
    : null;
}

function encryptedSecret({
  kind,
  secret,
}: {
  kind: SlackIntegrationKind;
  secret: string;
}): { botTokenEncrypted: string | null; webhookUrlEncrypted: string | null } {
  return kind === "BOT"
    ? { botTokenEncrypted: encrypt(secret), webhookUrlEncrypted: null }
    : { botTokenEncrypted: null, webhookUrlEncrypted: encrypt(secret) };
}
