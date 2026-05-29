import { TriggerAction } from "@prisma/client";
import annotationQueueClient, {
  type AnnotationQueueSlice,
} from "./definitions/annotationQueue/client";
import annotationQueueShared from "./definitions/annotationQueue/shared";
import datasetClient, {
  type DatasetSlice,
} from "./definitions/dataset/client";
import datasetShared from "./definitions/dataset/shared";
import emailClient, { type EmailSlice } from "./definitions/email/client";
import emailShared, { type EmailPreview } from "./definitions/email/shared";
import slackClient, { type SlackSlice } from "./definitions/slack/client";
import slackShared, { type SlackPreview } from "./definitions/slack/shared";
import {
  type ClientEntry,
  type NotifyClientEntry,
  isNotifyEntry,
} from "./types";

/** Per-action slice type — adding a new action means adding one entry. */
export interface SliceFor {
  [TriggerAction.SEND_EMAIL]: EmailSlice;
  [TriggerAction.SEND_SLACK_MESSAGE]: SlackSlice;
  [TriggerAction.ADD_TO_DATASET]: DatasetSlice;
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: AnnotationQueueSlice;
}

/** Per-action preview type. Action providers have no preview — they get
 *  `never`. The sum of notify previews is `NotifyPreview` below. */
export interface PreviewFor {
  [TriggerAction.SEND_EMAIL]: EmailPreview;
  [TriggerAction.SEND_SLACK_MESSAGE]: SlackPreview;
  [TriggerAction.ADD_TO_DATASET]: never;
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: never;
}

/** The sum of every notify provider's render-time preview shape — the
 *  type the orchestrator's `previewTemplate` mutation returns and the
 *  type every notify ConfigForm narrows from. Built from the registry,
 *  not enumerated here. */
export type NotifyPreview = PreviewFor[keyof PreviewFor];

/** The full slice record — one slice per provider, all present. The
 *  drawer keeps every slice in state so type-switching never loses
 *  user-entered data on the other provider. */
export type AllSlices = { [K in TriggerAction]: SliceFor[K] };

/** The client-side provider registry — pairs each shared definition with
 *  its client peer. Indexed by `TriggerAction`. */
export const CLIENT_PROVIDERS: Record<TriggerAction, ClientEntry> = {
  [TriggerAction.SEND_EMAIL]: { shared: emailShared, client: emailClient },
  [TriggerAction.SEND_SLACK_MESSAGE]: { shared: slackShared, client: slackClient },
  [TriggerAction.ADD_TO_DATASET]: { shared: datasetShared, client: datasetClient },
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: {
    shared: annotationQueueShared,
    client: annotationQueueClient,
  },
};

/** Convenience indexes for the UI. */
export const NOTIFY_PROVIDERS: NotifyClientEntry[] = Object.values(
  CLIENT_PROVIDERS,
).filter((p): p is NotifyClientEntry => isNotifyEntry(p));

export const ACTION_PROVIDERS: ClientEntry[] = Object.values(
  CLIENT_PROVIDERS,
).filter((p) => p.shared.category === "action");

/** Typed slice lookup — returns the right slice type for an action. */
export function getSlice<A extends TriggerAction>(
  slices: AllSlices,
  action: A,
): SliceFor[A] {
  return slices[action];
}

/** Build the initial slice record by asking each provider for its empty
 *  state. Used by the reducer's INITIAL_DRAFT. */
export function initialSlices(): AllSlices {
  return {
    [TriggerAction.SEND_EMAIL]: emailClient.initialSlice(),
    [TriggerAction.SEND_SLACK_MESSAGE]: slackClient.initialSlice(),
    [TriggerAction.ADD_TO_DATASET]: datasetClient.initialSlice(),
    [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: annotationQueueClient.initialSlice(),
  };
}
