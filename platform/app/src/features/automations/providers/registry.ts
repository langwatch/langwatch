import { TriggerAction } from "@langwatch/automation-contract";
import {
  createClientProviderRegistry,
  createAutomationDraftModel,
  initialSlices as initialProviderSlices,
  isNotifyProviderAction,
  type AllSlices as ProviderAllSlices,
  type NotifyPreview as ProviderNotifyPreview,
  type SliceFor as ProviderSliceFor,
} from "@langwatch/automation-web";
import annotationQueueClient, { type AnnotationQueueSlice } from "./annotationQueue/client";
import datasetClient, { type DatasetSlice } from "./dataset/client";
import emailClient, { type EmailSlice } from "./email/client";
import slackClient, { type SlackSlice } from "./slack/client";
import webhookClient, { type WebhookSlice } from "./webhook/client";

export const CLIENT_PROVIDERS = createClientProviderRegistry({
  [TriggerAction.SEND_EMAIL]: emailClient,
  [TriggerAction.SEND_SLACK_MESSAGE]: slackClient,
  [TriggerAction.SEND_WEBHOOK]: webhookClient,
  [TriggerAction.ADD_TO_DATASET]: datasetClient,
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: annotationQueueClient,
});

export const AUTOMATION_DRAFT_MODEL = createAutomationDraftModel(CLIENT_PROVIDERS);

export type AutomationProviderRegistry = typeof CLIENT_PROVIDERS;
export type AutomationProviderClients = {
  [A in TriggerAction]: AutomationProviderRegistry[A]["client"];
};
export type SliceFor<A extends TriggerAction> = ProviderSliceFor<AutomationProviderClients, A>;
export type AllSlices = ProviderAllSlices<AutomationProviderClients>;
export type NotifyPreview = ProviderNotifyPreview<AutomationProviderClients>;

export const initialSlices = (): AllSlices => initialProviderSlices(CLIENT_PROVIDERS);

export const NOTIFY_PROVIDERS = Object.values(CLIENT_PROVIDERS).filter((entry) =>
  isNotifyProviderAction(entry.shared.action),
);
export const ACTION_PROVIDERS = Object.values(CLIENT_PROVIDERS).filter(
  (entry) => !isNotifyProviderAction(entry.shared.action),
);

export type { AnnotationQueueSlice, DatasetSlice, EmailSlice, SlackSlice, WebhookSlice };
