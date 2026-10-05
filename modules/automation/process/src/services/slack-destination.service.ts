import { slackDeliveryMethodOf } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import { type SlackApi, SlackIntegrationMissingError } from "@langwatch/slack-contract";
import { z } from "zod";

import type { TriggerSecretSeal } from "../repositories/trigger.repository.ts";

/** Where one Slack delivery goes. A bot posts to the automation's channel. */
export type SlackDestination =
  | { kind: "bot"; token: string; channel: string | null }
  | { kind: "webhook"; url: string };

/** Stored Slack params, read leniently: a row is data, not a wire payload. */
const storedSlackParamsSchema = z.object({
  slackIntegrationId: z.string().nullish().catch(undefined),
  slackDelivery: z.enum(["webhook", "bot"]).nullish().catch(undefined),
  slackWebhook: z.string().nullish().catch(undefined),
  slackBotToken: z.string().nullish().catch(undefined),
  slackChannelId: z.string().nullish().catch(undefined),
});
type StoredSlackParams = z.infer<typeof storedSlackParamsSchema>;

function readStoredSlackParams(actionParams: unknown): StoredSlackParams {
  const read = storedSlackParamsSchema.safeParse(actionParams ?? {});
  return read.success ? read.data : {};
}

/**
 * Where a Slack delivery goes (ARCHITECTURE.md §3, the Slack ruling): a set
 * `slackIntegrationId` -> that connection through `SlackApi`, else nothing
 * (deletion must stop delivery); otherwise the legacy secret; otherwise nothing.
 */
export class SlackDestinationService {
  private constructor(
    private readonly slack: Pick<SlackApi, "findUsableSlackSecret">,
    private readonly triggers: TriggerSecretSeal,
  ) {}

  static create({
    slack,
    triggers,
  }: {
    slack: Pick<SlackApi, "findUsableSlackSecret">;
    triggers: TriggerSecretSeal;
  }): SlackDestinationService {
    return new SlackDestinationService(slack, triggers);
  }

  /** Zero or one destination for the automation's stored params. */
  async findSlackDestination({
    projectId,
    actionParams,
  }: {
    projectId: string;
    actionParams: unknown;
  }): Promise<SlackDestination[]> {
    const params = readStoredSlackParams(actionParams);
    const channel = params.slackChannelId?.trim() || null;
    if (!params.slackIntegrationId) return this.legacyDestination({ params, channel });
    const secrets = await this.slack.findUsableSlackSecret({
      id: params.slackIntegrationId,
      projectId,
    });
    return secrets.map((secret) =>
      secret.kind === "BOT"
        ? { kind: "bot", token: secret.token, channel }
        : { kind: "webhook", url: secret.url },
    );
  }

  /** {@link findSlackDestination}, refusing with `slack_integration_missing` instead of empty. */
  async getSlackDestination(input: {
    projectId: string;
    actionParams: unknown;
  }): Promise<SlackDestination> {
    const [destination] = await this.findSlackDestination(input);
    if (!destination) throw new SlackIntegrationMissingError();
    return destination;
  }

  /** An automation not yet migrated: its own bot token or webhook URL. */
  private legacyDestination({
    params,
    channel,
  }: {
    params: StoredSlackParams;
    channel: string | null;
  }): SlackDestination[] {
    const method = slackDeliveryMethodOf({ slackDelivery: params.slackDelivery ?? undefined });
    if (method === "bot") {
      const token = params.slackBotToken
        ? this.triggers.openSecret({ sealed: params.slackBotToken })
        : "";
      return token ? [{ kind: "bot", token, channel }] : [];
    }
    const url = params.slackWebhook?.trim();
    return url ? [{ kind: "webhook", url }] : [];
  }

  /**
   * The missing-connection refusal shaped for the outbox: no retry can fix it,
   * so it dead-letters, carrying the handled error as its cause.
   */
  getMissingDispatchError({ triggerName }: { triggerName: string }): DispatchError {
    const missing = new SlackIntegrationMissingError();
    return new DispatchError({
      message: `Slack delivery for "${triggerName}" has no usable connection: ${missing.message}`,
      retryable: false,
      cause: missing,
      customerMessage:
        "Pick a Slack connection in this automation's delivery settings, then try again.",
    });
  }
}
