import { TriggerAction } from "@prisma/client";
import annotationQueueServer from "./annotationQueue/server";
import annotationQueueShared from "@langwatch/automations/providers/annotationQueue";
import datasetServer from "./dataset/server";
import datasetShared from "@langwatch/automations/providers/dataset";
import emailServer from "./email/server";
import emailShared from "@langwatch/automations/providers/email";
import slackServer from "./slack/server";
import slackShared from "@langwatch/automations/providers/slack";
import webhookServer from "./webhook/server";
import webhookShared from "@langwatch/automations/providers/webhook";
import type { PersistActionParamsArgs, ServerEntry } from "./types";

/** The server-side provider registry — pairs each shared definition with
 *  its server peer. Server defs own actionParams persistence + redaction
 *  (secret handling); dispatch bodies stay on the dispatch path until
 *  Stage B of the provider model moves them in. */
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
    server: datasetServer,
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
export function redactActionParamsFor(
  action: TriggerAction,
  params: unknown,
): unknown {
  const hook = SERVER_PROVIDERS[action].server.redactActionParams;
  return hook ? hook(params) : params;
}
