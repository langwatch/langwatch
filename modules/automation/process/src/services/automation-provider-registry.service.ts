/**
 * Secret registry for all automation channels using the deployment's shared
 * cipher; each channel defines encryption/decryption for its own params.
 */
import {
  annotationQueueProvider as annotationQueueShared,
  datasetProvider as datasetShared,
  emailProvider as emailShared,
  MissingSlackBotTokenError,
  slackProvider as slackShared,
  TriggerAction,
  WEBHOOK_HEADER_VALUE_KEPT,
  webhookActionParamsSchema,
  webhookProvider as webhookShared,
  type SharedDef,
  type SlackActionParams,
} from "@langwatch/automation-contract";
import type { ZodTypeAny } from "zod";

import {
  AutomationSlackSecretsService,
  type AutomationSecretCrypto,
} from "#services/automation-slack-secrets.service";
import {
  AutomationWebhookSecretsService,
  type AutomationWebhookProvider,
  type AutomationWebhookStoredParams,
} from "#services/automation-webhook-secrets.service";

/** What a channel's persist hook is handed. */
export interface PersistActionParamsArgs {
  /** Schema-parsed wire `actionParams` for this channel. */
  incoming: unknown;
  /**
   * Lazily loads the saved row's stored `actionParams`, or `undefined`
   * while creating. Called only when a channel needs stored secrets (a
   * kept sentinel, say), so a plain save skips the extra read.
   */
  loadExisting: () => Promise<unknown>;
}

/** The server half of one channel. */
export interface ServerDef {
  /** The discriminator stored on the trigger row. */
  readonly action: TriggerAction;
  /**
   * Turns wire `actionParams` into their at-rest shape. Throws a
   * `HandledError` subclass for a failure the author can act on.
   */
  persistActionParams?(args: PersistActionParamsArgs): Promise<unknown>;
  /** Strips secrets before a stored row leaves the server. */
  redactActionParams?(params: unknown): unknown;
}

/** One channel: its portable definition, and its process-owned secret half. */
export interface ServerEntry {
  shared: SharedDef;
  server: ServerDef;
}

/** The five channels' secret handling, bound to one deployment's cipher. */
export class AutomationProviderRegistryService {
  static create(crypto: AutomationSecretCrypto): AutomationProviderRegistryService {
    return new AutomationProviderRegistryService(crypto);
  }

  /** The webhook channel's secret capability, exposed for the two read paths. */
  readonly webhooks: AutomationWebhookProvider;

  private readonly slack: AutomationSlackSecretsService;
  private readonly providers: Record<TriggerAction, ServerEntry>;

  private constructor(crypto: AutomationSecretCrypto) {
    this.webhooks = AutomationWebhookSecretsService.create(crypto);
    this.slack = AutomationSlackSecretsService.create(crypto);
    this.providers = {
      [TriggerAction.SEND_EMAIL]: {
        shared: emailShared,
        server: { action: TriggerAction.SEND_EMAIL },
      },
      [TriggerAction.SEND_SLACK_MESSAGE]: {
        shared: slackShared,
        server: this.slackServer(),
      },
      [TriggerAction.SEND_WEBHOOK]: { shared: webhookShared, server: this.webhookServer() },
      [TriggerAction.ADD_TO_DATASET]: {
        shared: datasetShared,
        server: { action: TriggerAction.ADD_TO_DATASET },
      },
      [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: {
        shared: annotationQueueShared,
        server: { action: TriggerAction.ADD_TO_ANNOTATION_QUEUE },
      },
    };
  }

  /**
   * The Zod schema for one action's `actionParams`. The upsert procedure
   * parses against it, so a malformed payload is refused per action type.
   */
  actionParamsSchemaFor(action: TriggerAction): ZodTypeAny {
    return this.providers[action].shared.actionParamsSchema;
  }

  /**
   * Turns schema-parsed wire `actionParams` into their at-rest shape through
   * the channel's persist hook: secrets encrypted, kept sentinels resolved.
   * The identity for a channel with no secrets.
   */
  async persistActionParamsFor(
    action: TriggerAction,
    args: PersistActionParamsArgs,
  ): Promise<unknown> {
    const hook = this.providers[action].server.persistActionParams;
    return hook ? hook(args) : args.incoming;
  }

  /** Strips secrets from stored `actionParams` before the row leaves. */
  redactActionParamsFor(action: TriggerAction, params: unknown): unknown {
    // Fail closed: a legacy row can carry an action value no channel claims —
    // after one is removed, say. Returning the params unredacted would leak
    // whatever secrets that action stored, so return nothing instead.
    const entry = this.providers[action] as ServerEntry | undefined;
    if (!entry) return {};
    const hook = entry.server.redactActionParams;
    return hook ? hook(params) : params;
  }

  /** The Slack bot token behind a delivery, or null when none is stored. */
  findDecryptedSlackBotToken(actionParams: unknown): string | null {
    return this.slack.findDecryptedToken((actionParams ?? {}) as SlackActionParams);
  }

  /** The custom headers a webhook delivery carries. */
  decryptWebhookHeaders(stored: AutomationWebhookStoredParams): Record<string, string> {
    return this.webhooks.decryptHeaders(stored);
  }

  /** The secrets a webhook delivery is signed with. */
  decryptWebhookSigningSecrets(stored: AutomationWebhookStoredParams): readonly string[] {
    return this.webhooks.decryptSigningSecrets(stored);
  }

  private slackServer(): ServerDef {
    const slack = this.slack;
    return {
      action: TriggerAction.SEND_SLACK_MESSAGE,
      persistActionParams: async ({ incoming, loadExisting }: PersistActionParamsArgs) => {
        const params = incoming as SlackActionParams;
        const existing =
          params.slackDelivery === "bot"
            ? ((await loadExisting()) as SlackActionParams | undefined)
            : undefined;
        if (slack.tokenMissing({ incoming: params, existing })) {
          throw new MissingSlackBotTokenError();
        }
        return slack.persist({ incoming: params, existing });
      },
      redactActionParams: (params) => slack.redact((params ?? {}) as SlackActionParams),
    };
  }

  private webhookServer(): ServerDef {
    const webhooks = this.webhooks;
    return {
      action: TriggerAction.SEND_WEBHOOK,
      persistActionParams: async ({ incoming, loadExisting }: PersistActionParamsArgs) => {
        const params = webhookActionParamsSchema.parse(incoming);
        const needsExisting =
          Object.values(params.headers ?? {}).includes(WEBHOOK_HEADER_VALUE_KEPT) ||
          (params.signingSecret ?? null) !== null;
        const existingValue = needsExisting ? await loadExisting() : undefined;
        const existing =
          existingValue === undefined || existingValue === null
            ? undefined
            : (existingValue as AutomationWebhookStoredParams);

        return webhooks.persist({ incoming: params, existing });
      },
      redactActionParams: (params) => webhooks.redact(webhooks.parseStored(params ?? {})),
    };
  }
}
