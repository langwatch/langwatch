import {
  annotationQueueProvider as annotationQueueShared,
  datasetProvider as datasetShared,
  emailProvider as emailShared,
  slackProvider as slackShared,
  WEBHOOK_HEADER_VALUE_KEPT,
  webhookActionParamsSchema,
  webhookProvider as webhookShared,
} from "@langwatch/automation-contract";
import { TriggerAction } from "@langwatch/automation-contract";
import {
  AutomationWebhookProviderPort,
  WebhookProviderAdapter,
} from "@langwatch/automation-server";
import annotationQueueServer from "./annotationQueue/server";
import emailServer from "./email/server";
import slackServer from "./slack/server";
import type { PersistActionParamsArgs, ServerDef, ServerEntry } from "./types";
import { decrypt, encrypt } from "~/utils/encryption";

export type { AutomationWebhookStoredParams };

/** The process host binds Automation's webhook secret capability once here. */
export const automationWebhookProvider: AutomationWebhookProviderPort =
  WebhookProviderAdapter.create({ encrypt, decrypt });

const webhookServer: ServerDef = {
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

    return automationWebhookProvider.persist({ incoming: params, existing });
  },
  redactActionParams: (params) =>
    automationWebhookProvider.redact(automationWebhookProvider.parseStored(params ?? {})),
};

/** Pairs portable provider definitions with process-owned secret handling. */
export const SERVER_PROVIDERS: Record<TriggerAction, ServerEntry> = {
  [TriggerAction.SEND_EMAIL]: { shared: emailShared, server: emailServer },
  [TriggerAction.SEND_SLACK_MESSAGE]: {
    shared: slackShared,
    server: slackServer,
  },
  [TriggerAction.SEND_WEBHOOK]: {
    shared: webhookShared,
    server: webhookServer,
  },
  [TriggerAction.ADD_TO_DATASET]: {
    shared: datasetShared,
    server: { action: TriggerAction.ADD_TO_DATASET },
  },
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: {
    shared: annotationQueueShared,
    server: annotationQueueServer,
  },
};

/** Lookup the Zod schema for an action's `actionParams`. The upsert
 *  route uses this to parse + reject malformed input per action type. */
export function actionParamsSchemaFor(action: TriggerAction) {
  return SERVER_PROVIDERS[action].shared.actionParamsSchema;
}

/** Transform schema-parsed wire actionParams into their at-rest shape via
 *  the provider's persist hook (encrypt secrets, resolve kept sentinels).
 *  Identity for providers without secrets. Throws `HandledError` subclasses
 *  for user-facing validation failures. */
export async function persistActionParamsFor(
  action: TriggerAction,
  args: PersistActionParamsArgs,
): Promise<unknown> {
  const hook = SERVER_PROVIDERS[action].server.persistActionParams;
  return hook ? await hook(args) : args.incoming;
}

/** Strip secrets from stored actionParams before the row leaves the server.
 *  Identity for providers without secrets. */
export function redactActionParamsFor(action: TriggerAction, params: unknown): unknown {
  // Fail closed: a legacy row can carry an action value no provider claims
  // (e.g. after an action is removed). Returning the params unredacted would
  // leak whatever secrets that action stored; return nothing instead.
  const entry = SERVER_PROVIDERS[action] as (typeof SERVER_PROVIDERS)[TriggerAction] | undefined;
  if (!entry) return {};
  const hook = entry.server.redactActionParams;
  return hook ? hook(params) : params;
}
