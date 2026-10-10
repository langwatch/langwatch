/** A public-API test fire: capped per project, sent to the saved row's own destination. */
import {
  findGraphAlertFromTriggerRow,
  findReportFromTriggerRow,
  TestFireUnavailableError,
  TriggerAction,
  TriggerTestFireRateLimitedError,
  type TestFireInput,
  type TestFireResult,
  type Trigger,
  type TriggerAction as TriggerActionValue,
} from "@langwatch/automation-contract";
import { z } from "zod";

import type {
  AutomationCallCounter,
  AutomationProviderSecrets,
  AutomationWebhookStoredParams,
} from "../app/automation.app.ts";
import type { SlackDestinationService } from "../features/slack/services/slack-destination.service.ts";
import type { AutomationRulesService } from "./automation-rules.service.ts";
import type { AutomationService } from "./automation.service.ts";

/** The dashboard's test-fire window, keyed on the project an API key acts for. */
const TEST_FIRE_WINDOW_SECONDS = 60;
const TEST_FIRE_MAX_PER_WINDOW = 10;

const memberAddressesSchema = z.array(z.string()).catch([]);

interface AutomationRestTestFireCollaborators {
  automation: Pick<AutomationService, "testFire">;
  rules: Pick<AutomationRulesService, "getProjectIdentity">;
  providers: AutomationProviderSecrets;
  slackDestinations: Pick<SlackDestinationService, "findSlackDestination">;
  limits: AutomationCallCounter;
}

export class AutomationRestTestFireService {
  static create(collaborators: AutomationRestTestFireCollaborators): AutomationRestTestFireService {
    return new AutomationRestTestFireService(collaborators);
  }

  private constructor(private readonly deps: AutomationRestTestFireCollaborators) {}

  /**
   * Send this automation's message to its saved destination, never one the
   * request supplies. The per-project cap bounds how often a key can make
   * LangWatch send (ADR-040 §4); nothing is recorded as a fire.
   */
  async fire(trigger: Trigger): Promise<TestFireResult> {
    const { projectId } = trigger;
    await this.assertTestFireAllowed({ action: trigger.action, projectId });
    const project = await this.deps.rules.getProjectIdentity(projectId);
    const graphAlert = findGraphAlertFromTriggerRow(trigger.actionParams);
    const report = findReportFromTriggerRow(trigger.actionParams);

    return this.deps.automation.testFire({
      trigger: { name: trigger.name, alertType: trigger.alertType },
      project,
      draft: trigger.templates,
      graphAlert: graphAlert
        ? {
            metricLabel: graphAlert.seriesName,
            operator: graphAlert.operator,
            threshold: graphAlert.threshold,
            timePeriodMinutes: graphAlert.timePeriod,
          }
        : null,
      report: report ? { sourceKind: report.source.kind } : null,
      ...(await this.savedDestination(trigger)),
    });
  }

  /** Email and webhook share a provider or hit any host, so both are capped; Slack is pinned. */
  private async assertTestFireAllowed({
    action,
    projectId,
  }: {
    action: TriggerActionValue;
    projectId: string;
  }): Promise<void> {
    if (action !== TriggerAction.SEND_EMAIL && action !== TriggerAction.SEND_WEBHOOK) return;
    const limit = await this.deps.limits.count({
      key: `testfire:project:${projectId}`,
      windowSeconds: TEST_FIRE_WINDOW_SECONDS,
      max: TEST_FIRE_MAX_PER_WINDOW,
    });
    if (!limit.allowed) throw new TriggerTestFireRateLimitedError(limit.resetAt);
  }

  /** Where the test fire goes: the saved row's destination, read as a real delivery reads it. */
  private async savedDestination(
    trigger: Trigger,
  ): Promise<
    Pick<
      TestFireInput,
      "channel" | "recipients" | "webhook" | "botDestination" | "webhookDestination"
    >
  > {
    const params = trigger.actionParams;
    switch (trigger.action) {
      case TriggerAction.SEND_EMAIL: {
        const recipients = memberAddressesSchema.parse(params.members);
        if (recipients.length === 0) {
          throw new TestFireUnavailableError(
            "email",
            "This automation has no email recipients to test-fire to.",
          );
        }
        return { channel: "email", recipients, webhook: null };
      }
      case TriggerAction.SEND_SLACK_MESSAGE:
        return this.savedSlackDestination({ params, projectId: trigger.projectId });
      case TriggerAction.SEND_WEBHOOK:
        return this.savedWebhookDestination(params);
      default:
        // Dataset rows and queue items are written, not delivered: nothing a test fire could prove.
        throw new TestFireUnavailableError(
          "email",
          "This automation writes a record rather than sending a message, so there is nothing to test-fire.",
        );
    }
  }

  private async savedSlackDestination({
    params,
    projectId,
  }: {
    params: Record<string, unknown>;
    projectId: string;
  }): Promise<Pick<TestFireInput, "channel" | "recipients" | "webhook" | "botDestination">> {
    const [destination] = await this.deps.slackDestinations.findSlackDestination({
      projectId,
      actionParams: params,
    });
    if (!destination) {
      throw new TestFireUnavailableError(
        "slack",
        "This automation has no Slack connection to test-fire to.",
      );
    }
    if (destination.kind === "webhook")
      return { channel: "slack", recipients: [], webhook: destination.url };
    if (!destination.channel) {
      // Fail closed: a bot connection without a channel has nowhere to post.
      throw new TestFireUnavailableError(
        "slack",
        "This automation delivers through a Slack connection, and no channel resolves for it.",
      );
    }
    return {
      channel: "slack",
      recipients: [],
      webhook: null,
      botDestination: { token: destination.token, channel: destination.channel },
    };
  }

  /** The full request a real delivery would make, signed the same way. */
  private savedWebhookDestination(
    params: Record<string, unknown>,
  ): Pick<TestFireInput, "channel" | "recipients" | "webhook" | "webhookDestination"> {
    const stored = storedWebhookSchema.safeParse(params);
    if (!stored.success) {
      throw new TestFireUnavailableError(
        "webhook",
        "This automation has no destination to test-fire to.",
      );
    }
    const webhookParams: AutomationWebhookStoredParams = {
      ...stored.data,
      method: stored.data.method ?? "POST",
    };
    return {
      channel: "webhook",
      recipients: [],
      webhook: null,
      webhookDestination: {
        url: stored.data.url,
        method: stored.data.method ?? "POST",
        headers: this.deps.providers.decryptWebhookHeaders(webhookParams),
        bodyTemplate: stored.data.bodyTemplate ?? null,
        signingSecrets: this.deps.providers.decryptWebhookSigningSecrets(webhookParams),
      },
    };
  }
}

/** The at-rest webhook fields a test fire reads; a row with no url has nowhere to go. */
const storedWebhookSchema = z
  .object({
    url: z.string().min(1),
    method: z.enum(["POST", "PUT", "PATCH"]).optional(),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    contentType: z.string().optional(),
    headersEncrypted: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    signingSecretEncrypted: z.string().optional(),
    previousSigningSecretEncrypted: z.string().optional(),
    previousSigningSecretExpiresAt: z.number().optional(),
  })
  .loose();
