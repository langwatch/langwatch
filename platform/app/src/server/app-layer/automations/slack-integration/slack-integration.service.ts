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
  SlackConnectionRecord,
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

type SlackScope = Pick<SlackConnectionRecord, "scopeType" | "scopeId">;

/** A secret's stored form: ciphertext, fingerprint, hint and Slack workspace. */
type StoredSecret = Pick<
  SlackConnectionRecord,
  | "botTokenEncrypted"
  | "webhookUrlEncrypted"
  | "secretFingerprint"
  | "secretHint"
  | "slackTeamId"
  | "slackTeamName"
>;

/**
 * Named Slack connections (ADR-093 §5a): any number per organization, each a
 * bot token or an incoming webhook, scoped to the organization or one project.
 * One secret is one connection per scope and no save widens a scope; a bot
 * token is checked with Slack before it is stored, and no secret is returned.
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
    const stored = await this.storedSecret({ kind, secret: secret.trim() });
    const guard = {
      organizationId: scope.organizationId,
      target: { scopeType, scopeId },
      secretFingerprint: stored.secretFingerprint,
    };
    await this.assertSecretFree(guard);
    const row = await this.repo.create({
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
      await this.assertSecretFree(guard);
      throw new Error("Slack connection create lost a race it cannot name");
    }
    return this.toView({ row, scope, dependentAutomations: 0 });
  }

  /**
   * Rename, move or replace the secret. An absent secret keeps the stored one;
   * narrowing to one project other projects rely on needs `force`.
   */
  async update({
    scope,
    connection,
    name,
    scopeType,
    scopeId,
    secret,
    actorId,
    force = false,
  }: {
    scope: SlackProjectScope;
    connection: SlackIntegration;
    name?: string;
    scopeType?: SlackIntegrationScopeType;
    scopeId?: string;
    secret?: string;
    actorId: string;
    force?: boolean;
  }): Promise<SlackConnectionView> {
    const changes: SlackConnectionChanges = {
      ...(name === undefined ? {} : { name: name.trim() }),
      ...(scopeType === undefined ? {} : { scopeType }),
      ...(scopeId === undefined ? {} : { scopeId }),
    };
    const value = secret?.trim();
    if (value) {
      Object.assign(
        changes,
        await this.storedSecret({ kind: connection.kind, secret: value }),
      );
    }
    const guard = {
      organizationId: connection.organizationId,
      target: {
        scopeType: changes.scopeType ?? connection.scopeType,
        scopeId: changes.scopeId ?? connection.scopeId,
      },
      secretFingerprint:
        changes.secretFingerprint ?? connection.secretFingerprint,
      exceptId: connection.id,
    };
    await this.assertNarrowingStrandsNothing({
      connection,
      target: guard.target,
      force,
    });
    if (value || scopeType !== undefined || scopeId !== undefined) {
      await this.assertSecretFree(guard);
    }
    const row = await this.repo.update({
      id: connection.id,
      organizationId: connection.organizationId,
      changes,
      actorId,
    });
    if (!row) {
      await this.assertSecretFree(guard);
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

  /**
   * An organization connection narrowed to one project stops delivering for
   * every other project's automations: refused with their count until confirmed.
   */
  private async assertNarrowingStrandsNothing({
    connection,
    target,
    force,
  }: {
    connection: SlackIntegration;
    target: SlackScope;
    force: boolean;
  }): Promise<void> {
    if (force || connection.scopeType !== "ORGANIZATION") return;
    if (target.scopeType !== "PROJECT") return;
    const counts = await this.repo.countDependentAutomations({
      organizationId: connection.organizationId,
      ids: [connection.id],
      exceptProjectId: target.scopeId,
    });
    const dependentAutomations = counts.get(connection.id) ?? 0;
    if (dependentAutomations > 0) {
      throw new SlackConnectionInUseError({ dependentAutomations });
    }
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
   * A connection this project can already use holding the secret, else a new
   * project connection. Never widens a scope: another project's copy is left
   * as it is (§5a). A bot token Slack refuses is still stored, named from its hint.
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
  }): Promise<{ id: string; wasCreated: boolean }> {
    const value = secret.trim();
    const secretFingerprint = slackSecretFingerprint({ secret: value });
    const reach = { organizationId, projectId, secretFingerprint };
    const existing = await this.findReachableHolder(reach);
    if (existing) return { id: existing.id, wasCreated: false };

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
    if (row) return { id: row.id, wasCreated: true };

    // Lost a race to a concurrent save of this secret into this project.
    const raced = await this.findReachableHolder(reach);
    if (!raced) throw new Error("Slack connection create lost a race");
    return { id: raced.id, wasCreated: false };
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
    if (!channel) throw slackChannelRequired();
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
    // Refused before anything is stored, so a refused save leaves no connection.
    if (kind === "BOT" && !fields.slackChannelId?.trim()) {
      throw slackChannelRequired();
    }
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

  /** The project's own connection holding the secret, else its organization's. */
  private async findReachableHolder({
    organizationId,
    projectId,
    secretFingerprint,
  }: {
    organizationId: string;
    projectId: string;
    secretFingerprint: string;
  }): Promise<SlackIntegration | undefined> {
    const holders = await this.repo.findAllByFingerprint({
      organizationId,
      secretFingerprint,
      scopes: reachableScopes({ organizationId, projectId }),
    });
    return (
      holders.find((holder) => holder.scopeType === "PROJECT") ?? holders[0]
    );
  }

  /** A typed secret's stored form; a bot token must be accepted by Slack first. */
  private async storedSecret({
    kind,
    secret,
  }: {
    kind: SlackIntegrationKind;
    secret: string;
  }): Promise<StoredSecret> {
    const identity =
      kind === "BOT" ? await this.verifyBotToken({ token: secret }) : null;
    return {
      ...encryptedSecret({ kind, secret }),
      secretFingerprint: slackSecretFingerprint({ secret }),
      secretHint: slackSecretHint({ secret }),
      slackTeamId: identity?.teamId ?? null,
      slackTeamName: identity?.teamName ?? null,
    };
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

  /**
   * Refuses a write whose secret its target scope already holds. A project
   * write also counts its organization's connections, which the project can
   * already use; another project's copy never counts, nor is it named.
   */
  private async assertSecretFree({
    organizationId,
    target,
    secretFingerprint,
    exceptId,
  }: {
    organizationId: string;
    target: SlackScope;
    secretFingerprint: string;
    exceptId?: string;
  }): Promise<void> {
    const holders = await this.repo.findAllByFingerprint({
      organizationId,
      secretFingerprint,
      scopes:
        target.scopeType === "ORGANIZATION"
          ? [target]
          : reachableScopes({ organizationId, projectId: target.scopeId }),
    });
    const holder = holders.find((each) => each.id !== exceptId);
    if (holder) {
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

function slackChannelRequired(): InvalidActionParamsError {
  return new InvalidActionParamsError(
    "A Slack channel is required for a bot connection.",
    "slackChannelId",
  );
}

/** The scopes a project reaches: its organization's and its own (ADR-093 §5a). */
function reachableScopes({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}): SlackScope[] {
  return [
    { scopeType: "ORGANIZATION", scopeId: organizationId },
    { scopeType: "PROJECT", scopeId: projectId },
  ];
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
