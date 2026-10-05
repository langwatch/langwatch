import { InvalidActionParamsError, SLACK_BOT_TOKEN_KEPT } from "@langwatch/automation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SlackApi, SlackConnectionKind } from "@langwatch/slack-contract";
import { z } from "zod";

import type { TriggerSecretSeal } from "../repositories/trigger.repository.ts";

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
type SlackSaveFields = z.infer<typeof slackSaveFieldsSchema>;

/** A trigger's side of a claim: whether it holds one, and on which params. */
export interface SlackClaimState {
  actionParams: unknown;
  active: boolean;
}

/** A secret the caller actually typed, as opposed to a kept or read-back value. */
function findFreshSecret(value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SLACK_BOT_TOKEN_KEPT || trimmed === REDACTED_PLACEHOLDER) return [];
  return [trimmed];
}

function slackChannelRequired(): InvalidActionParamsError {
  return new InvalidActionParamsError(
    "A Slack channel is required for a bot connection.",
    "slackChannelId",
  );
}

/** The connection a claim state holds, when it holds one (active and on a connection). */
function claimedConnectionIds(state: SlackClaimState | undefined): string[] {
  if (!state?.active) return [];
  const fields = slackSaveFieldsSchema.safeParse(state.actionParams ?? {});
  const id = fields.success ? fields.data.slackIntegrationId?.trim() : undefined;
  return id ? [id] : [];
}

/**
 * Automation's half of a Slack save (ARCHITECTURE.md §3, the Slack ruling):
 * parses its own Slack params, asks `SlackApi` for the connection, and claims
 * or releases the connection each trigger write puts it on or takes it off.
 */
export class AutomationSlackConnectionService {
  private constructor(
    private readonly slack: Pick<
      SlackApi,
      | "getUsableSlackConnection"
      | "findOrCreateSlackConnectionForSecret"
      | "claimConnection"
      | "releaseConnection"
    >,
    private readonly projects: Pick<ProjectApi, "getOrganizationId">,
    private readonly triggers: TriggerSecretSeal,
  ) {}

  static create({
    slack,
    projects,
    triggers,
  }: {
    slack: Pick<
      SlackApi,
      | "getUsableSlackConnection"
      | "findOrCreateSlackConnectionForSecret"
      | "claimConnection"
      | "releaseConnection"
    >;
    projects: Pick<ProjectApi, "getOrganizationId">;
    triggers: TriggerSecretSeal;
  }): AutomationSlackConnectionService {
    return new AutomationSlackConnectionService(slack, projects, triggers);
  }

  /**
   * Points a save's Slack params at a connection: the one it names, else a
   * typed legacy secret stored as one. Either way the delivery method is the
   * connection's kind and no secret stays. A save with neither is left alone.
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
    const [connectionId] = fields.data.slackIntegrationId
      ? [fields.data.slackIntegrationId]
      : await this.connectLegacySecret({ projectId, actorId, fields: fields.data });
    if (!connectionId) return actionParams;

    const connection = await this.slack.getUsableSlackConnection({ id: connectionId, projectId });
    const {
      slackWebhook: _webhook,
      slackBotToken: _token,
      slackBotTokenSet: _tokenSet,
      slackChannelId: _channel,
      ...rest
    } = actionParams;
    if (connection.kind === "INCOMING_WEBHOOK") {
      return { ...rest, slackIntegrationId: connection.id, slackDelivery: "webhook" };
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

  /**
   * A save of a row not yet migrated that types no secret keeps the one the
   * row stores, put back in plaintext, so the save moves it into a connection
   * like a typed one instead of writing it back.
   */
  withKeptLegacySlackSecret({
    actionParams,
    stored,
  }: {
    actionParams: Record<string, unknown>;
    stored: unknown;
  }): Record<string, unknown> {
    const incoming = slackSaveFieldsSchema.safeParse(actionParams);
    const kept = slackSaveFieldsSchema.safeParse(stored ?? {});
    if (!incoming.success || !kept.success) return actionParams;
    if (incoming.data.slackIntegrationId || kept.data.slackIntegrationId) return actionParams;
    const [secret] = this.keptLegacySecret({ incoming: incoming.data, kept: kept.data });
    return secret ? { ...actionParams, ...secret } : actionParams;
  }

  /**
   * Moves the trigger's claim from what it held before the write to what it
   * holds after (`undefined` = no row). Claims again when it stays on the same
   * connection, which refreshes the label on a rename. A failed claim throws.
   */
  async updateConnectionClaim({
    projectId,
    trigger,
    before,
    after,
  }: {
    projectId: string;
    trigger: { id: string; name: string };
    before: SlackClaimState | undefined;
    after: SlackClaimState | undefined;
  }): Promise<void> {
    const held = claimedConnectionIds(before);
    const holds = claimedConnectionIds(after);
    for (const connectionId of held.filter((id) => !holds.includes(id))) {
      await this.slack.releaseConnection({ connectionId, projectId, claimantId: trigger.id });
    }
    for (const connectionId of holds) {
      await this.slack.claimConnection({
        connectionId,
        projectId,
        claimant: { id: trigger.id, label: trigger.name },
      });
    }
  }

  /** A freshly typed legacy secret, stored as a connection; empty when none. */
  private async connectLegacySecret({
    projectId,
    actorId,
    fields,
  }: {
    projectId: string;
    actorId: string;
    fields: SlackSaveFields;
  }): Promise<string[]> {
    const kind: SlackConnectionKind = fields.slackDelivery === "bot" ? "BOT" : "INCOMING_WEBHOOK";
    const [secret] = findFreshSecret(kind === "BOT" ? fields.slackBotToken : fields.slackWebhook);
    if (!secret) return [];
    // Refused before anything is stored, so a refused save leaves no connection.
    if (kind === "BOT" && !fields.slackChannelId?.trim()) throw slackChannelRequired();
    const organizationId = await this.projects.getOrganizationId(projectId);
    const { id } = await this.slack.findOrCreateSlackConnectionForSecret({
      organizationId,
      projectId,
      kind,
      secret,
      actorId,
    });
    return [id];
  }

  /** The stored secret for the save's method, unless the save typed its own. */
  private keptLegacySecret({
    incoming,
    kept,
  }: {
    incoming: SlackSaveFields;
    kept: SlackSaveFields;
  }): ({ slackBotToken: string } | { slackWebhook: string })[] {
    if (incoming.slackDelivery === "bot") {
      if (findFreshSecret(incoming.slackBotToken).length > 0) return [];
      const token = this.decryptedLegacyToken(kept.slackBotToken);
      return token ? [{ slackBotToken: token }] : [];
    }
    if (findFreshSecret(incoming.slackWebhook).length > 0) return [];
    const [url] = findFreshSecret(kept.slackWebhook);
    return url ? [{ slackWebhook: url }] : [];
  }

  /** A stored token that cannot be decrypted is no secret: the save keeps none. */
  private decryptedLegacyToken(ciphertext: string | null | undefined): string | undefined {
    if (!ciphertext) return undefined;
    try {
      return findFreshSecret(this.triggers.openSecret({ sealed: ciphertext }))[0];
    } catch {
      return undefined;
    }
  }
}
