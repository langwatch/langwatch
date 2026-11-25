/** Who and where an author's test fire reaches, once it is counted against their limit. */
import {
  TestFireRateLimitedError,
  TestFireUnavailableError,
  type AutomationApiTestFireInput,
  type AutomationAuthor,
  type AutomationTestFireAuthor,
  type TestFireInput,
  type TestFireWebhookDestination,
} from "@langwatch/automation-contract";
import { SlackIntegrationMissingError } from "@langwatch/slack-contract";
import { WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/webhook-contract";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationWebhookStoredParams,
} from "../app/automation.app.ts";
import type { SlackDestinationService } from "../features/slack/services/slack-destination.service.ts";
import { resolveKeptWebhookHeaders } from "../rules/automation-authoring.rules.ts";
import { buildRetryAfterMessage } from "../rules/retry-after-message.rules.ts";
import type { AutomationService } from "./automation.service.ts";

/** How often one person may press the test-fire button, and over what window. */
const TEST_FIRE_WINDOW_SECONDS = 60;
const TEST_FIRE_MAX_PER_WINDOW = 10;

/** What resolving a test fire reaches. */
interface AutomationTestFireDestinationCollaborators {
  automation: Pick<AutomationService, "findById">;
  providers: AutomationProviderSecrets;
  slackDestinations: SlackDestinationService;
  limits: AutomationCallCounter;
}

export class AutomationTestFireDestinationService {
  static create(
    collaborators: AutomationTestFireDestinationCollaborators,
  ): AutomationTestFireDestinationService {
    return new AutomationTestFireDestinationService(collaborators);
  }

  private constructor(private readonly collaborators: AutomationTestFireDestinationCollaborators) {}

  /** Counts the fire, then resolves its recipients and its Slack and webhook destinations. */
  async resolve(args: {
    input: AutomationApiTestFireInput;
    author: AutomationTestFireAuthor;
  }): Promise<
    Pick<TestFireInput, "recipients" | "botDestination" | "webhook" | "webhookDestination">
  > {
    const { input, author } = args;
    await this.countTestFire({ channel: input.channel, author });

    const recipients = this.testFireRecipients({ channel: input.channel, author });
    const { botDestination, webhook } = await this.testFireSlack(input);
    const webhookDestination = await this.testFireWebhook(input);
    return { recipients, botDestination, webhook, webhookDestination };
  }

  /**
   * A webhook fires at an ARBITRARY customer URL from our egress, so an
   * uncapped test button would be a flood primitive (ADR-040 §4). Slack and
   * email are exempt: both destinations are pinned, not customer-supplied.
   */
  private async countTestFire(args: {
    channel: AutomationApiTestFireInput["channel"];
    author: AutomationAuthor;
  }): Promise<void> {
    if (args.channel !== "email" && args.channel !== "webhook") return;

    const limit = await this.collaborators.limits.count({
      key: `testfire:${args.author.id}`,
      windowSeconds: TEST_FIRE_WINDOW_SECONDS,
      max: TEST_FIRE_MAX_PER_WINDOW,
    });

    if (limit.allowed) return;

    throw new TestFireRateLimitedError(
      buildRetryAfterMessage({ prefix: "Too many test fires.", resetAt: limit.resetAt }),
      limit.resetAt,
    );
  }

  /** ADR-031: a test fire is not an open relay - the recipient is the author. */
  private testFireRecipients(args: {
    channel: AutomationApiTestFireInput["channel"];
    author: AutomationTestFireAuthor;
  }): string[] {
    if (args.channel !== "email") return [];

    if (!args.author.email) {
      throw new TestFireUnavailableError(
        "email",
        "Your account has no email address to send a test fire to.",
      );
    }

    return [args.author.email];
  }

  /**
   * The Slack destination a test fire posts to, resolved as a real delivery
   * does: the draft's connection, else a freshly typed legacy token, else the
   * saved automation's own resolution. The kind decides the surface.
   */
  private async testFireSlack(input: AutomationApiTestFireInput): Promise<{
    botDestination: { token: string; channel: string } | null;
    webhook: string | null;
  }> {
    if (input.channel !== "slack") return { botDestination: null, webhook: input.webhook };
    const channel = input.botDestination?.channelId.trim() ?? "";

    if (input.slackIntegrationId) {
      const destination = await this.collaborators.slackDestinations.getSlackDestination({
        projectId: input.projectId,
        actionParams: { slackIntegrationId: input.slackIntegrationId },
      });
      if (destination.kind === "webhook") return { botDestination: null, webhook: destination.url };
      if (!channel) throw pickSlackChannel();
      return { botDestination: { token: destination.token, channel }, webhook: input.webhook };
    }
    if (!input.botDestination) return { botDestination: null, webhook: input.webhook };

    const typed = input.botDestination.botToken?.trim();
    const token = typed || (await this.savedSlackBotToken(input));
    if (!token) throw new SlackIntegrationMissingError();
    if (!channel) throw pickSlackChannel();
    return { botDestination: { token, channel }, webhook: input.webhook };
  }

  /** The saved automation's bot token, through the same resolution delivery uses. */
  private async savedSlackBotToken(input: AutomationApiTestFireInput): Promise<string | undefined> {
    const saved = input.automationId
      ? await this.collaborators.automation.findById({
          triggerId: input.automationId,
          projectId: input.projectId,
        })
      : null;
    const [destination] = await this.collaborators.slackDestinations.findSlackDestination({
      projectId: input.projectId,
      actionParams: saved?.actionParams,
    });
    return destination?.kind === "bot" ? destination.token : undefined;
  }

  /**
   * ADR-040 §3: header secrets never reach the client, so a kept header and
   * signing secret resolve from the saved automation. The test fire then
   * signs exactly like a real one, letting an author verify their receiver.
   */
  private async testFireWebhook(
    input: AutomationApiTestFireInput,
  ): Promise<TestFireWebhookDestination | null> {
    let destination = input.webhookDestination;

    if (!destination) return null;

    const keepsSavedHeaders = Object.values(destination.headers).includes(
      WEBHOOK_HEADER_VALUE_KEPT,
    );

    if (keepsSavedHeaders) {
      let saved: Record<string, string> = {};

      if (input.automationId) {
        const row = await this.collaborators.automation.findById({
          triggerId: input.automationId,
          projectId: input.projectId,
        });
        const stored = (row?.actionParams ?? {}) as AutomationWebhookStoredParams;

        if (stored?.url !== destination.url) {
          throw new TestFireUnavailableError(
            "webhook",
            "Re-enter webhook header values after changing the destination URL.",
          );
        }

        saved = this.collaborators.providers.decryptWebhookHeaders(stored);
      }

      destination = {
        ...destination,
        headers: resolveKeptWebhookHeaders(destination.headers, saved),
      };
    }

    if (!input.automationId) return destination;

    const row = await this.collaborators.automation.findById({
      triggerId: input.automationId,
      projectId: input.projectId,
    });
    const stored = (row?.actionParams ?? {}) as AutomationWebhookStoredParams;
    const signingSecrets = this.collaborators.providers.decryptWebhookSigningSecrets(stored);
    if (signingSecrets.length === 0) return destination;

    // A secret belongs to the saved endpoint: signing for a draft pointed elsewhere
    // would hand valid signatures to whoever controls the new URL.
    if (stored.url !== destination.url) {
      throw new TestFireUnavailableError(
        "webhook",
        "Save the new destination URL before sending a signed test fire. " +
          "The signing secret is only used with the saved URL.",
      );
    }

    return { ...destination, signingSecrets };
  }
}

/** A bot test fire needs a channel to post in. */
function pickSlackChannel(): TestFireUnavailableError {
  return new TestFireUnavailableError("slack", "Pick a Slack channel before sending a test fire.");
}
