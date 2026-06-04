import { TriggerAction } from "@prisma/client";
import annotationQueueServer from "./definitions/annotationQueue/server";
import annotationQueueShared from "./definitions/annotationQueue/shared";
import datasetServer from "./definitions/dataset/server";
import datasetShared from "./definitions/dataset/shared";
import emailServer from "./definitions/email/server";
import emailShared from "./definitions/email/shared";
import slackServer from "./definitions/slack/server";
import slackShared from "./definitions/slack/shared";
import type { ServerEntry } from "./types";

/** The server-side provider registry — pairs each shared definition with
 *  its server peer. In Stage A the `server` entries are stubs that just
 *  carry the action discriminator; Stage B (separate ADR) moves the
 *  dispatch bodies in and switches `triggerActionDispatch.ts` to look
 *  the dispatcher up here instead of switching on `action`. */
export const SERVER_PROVIDERS: Record<TriggerAction, ServerEntry> = {
  [TriggerAction.SEND_EMAIL]: { shared: emailShared, server: emailServer },
  [TriggerAction.SEND_SLACK_MESSAGE]: { shared: slackShared, server: slackServer },
  [TriggerAction.ADD_TO_DATASET]: { shared: datasetShared, server: datasetServer },
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
