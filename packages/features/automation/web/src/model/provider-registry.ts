import {
  annotationQueueProvider,
  datasetProvider,
  emailProvider,
  slackProvider,
  TriggerAction,
  webhookProvider,
} from "@langwatch/automation-contract";
import type { SavedTriggerRow, TemplateDraft } from "@langwatch/automation-contract";
import type { NotifyClientDef, SummaryIdentity } from "./provider-types";

interface ProviderClientShape {
  readonly Icon: unknown;
  initialSlice(): unknown;
  isComplete(slice: unknown): boolean;
  summary(slice: unknown, identity: SummaryIdentity): string;
  fromTriggerRow(row: SavedTriggerRow): unknown;
  toActionParams(slice: unknown): unknown;
  readonly ConfigForm: unknown;
}

interface NotifyProviderClientShape extends ProviderClientShape {
  readonly channel: "email" | "slack" | "webhook";
  testFireTarget(slice: unknown): unknown;
  templatesFromSlice(slice: unknown): TemplateDraft;
  previewOptions?(slice: unknown): { allowGatedBlocks?: boolean };
}

export type ProviderClients = {
  SEND_EMAIL: NotifyProviderClientShape;
  SEND_SLACK_MESSAGE: NotifyProviderClientShape;
  SEND_WEBHOOK: NotifyProviderClientShape;
  ADD_TO_DATASET: ProviderClientShape;
  ADD_TO_ANNOTATION_QUEUE: ProviderClientShape;
};

export type ClientProviderRegistry<C extends ProviderClients = ProviderClients> = {
  [A in TriggerAction]: {
    shared: (typeof sharedProviders)[A];
    client: C[A];
  };
};

const sharedProviders = {
  [TriggerAction.SEND_EMAIL]: emailProvider,
  [TriggerAction.SEND_SLACK_MESSAGE]: slackProvider,
  [TriggerAction.SEND_WEBHOOK]: webhookProvider,
  [TriggerAction.ADD_TO_DATASET]: datasetProvider,
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: annotationQueueProvider,
} as const;

export type SliceFor<C extends ProviderClients, A extends TriggerAction> = C[A] extends {
  initialSlice(): infer S;
}
  ? S
  : never;

export type AllSlices<C extends ProviderClients> = {
  [A in TriggerAction]: SliceFor<C, A>;
};

export type PreviewFor<C extends ProviderClients, A extends TriggerAction> =
  C[A] extends NotifyClientDef<infer _Slice, infer Preview> ? Preview : never;

export type NotifyPreview<C extends ProviderClients> =
  | PreviewFor<C, "SEND_EMAIL">
  | PreviewFor<C, "SEND_SLACK_MESSAGE">
  | PreviewFor<C, "SEND_WEBHOOK">;

export function createClientProviderRegistry<C extends ProviderClients>(
  clients: C,
): ClientProviderRegistry<C> {
  return {
    [TriggerAction.SEND_EMAIL]: {
      shared: emailProvider,
      client: clients[TriggerAction.SEND_EMAIL],
    },
    [TriggerAction.SEND_SLACK_MESSAGE]: {
      shared: slackProvider,
      client: clients[TriggerAction.SEND_SLACK_MESSAGE],
    },
    [TriggerAction.SEND_WEBHOOK]: {
      shared: webhookProvider,
      client: clients[TriggerAction.SEND_WEBHOOK],
    },
    [TriggerAction.ADD_TO_DATASET]: {
      shared: datasetProvider,
      client: clients[TriggerAction.ADD_TO_DATASET],
    },
    [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: {
      shared: annotationQueueProvider,
      client: clients[TriggerAction.ADD_TO_ANNOTATION_QUEUE],
    },
  } as ClientProviderRegistry<C>;
}

export function initialSlices<C extends ProviderClients>(
  registry: ClientProviderRegistry<C>,
): AllSlices<C> {
  return {
    [TriggerAction.SEND_EMAIL]: registry[TriggerAction.SEND_EMAIL].client.initialSlice(),
    [TriggerAction.SEND_SLACK_MESSAGE]:
      registry[TriggerAction.SEND_SLACK_MESSAGE].client.initialSlice(),
    [TriggerAction.SEND_WEBHOOK]: registry[TriggerAction.SEND_WEBHOOK].client.initialSlice(),
    [TriggerAction.ADD_TO_DATASET]: registry[TriggerAction.ADD_TO_DATASET].client.initialSlice(),
    [TriggerAction.ADD_TO_ANNOTATION_QUEUE]:
      registry[TriggerAction.ADD_TO_ANNOTATION_QUEUE].client.initialSlice(),
  } as AllSlices<C>;
}

export function getSlice<C extends ProviderClients, A extends TriggerAction>(
  slices: AllSlices<C>,
  action: A,
): SliceFor<C, A> {
  return slices[action];
}

export const isNotifyProviderAction = (action: TriggerAction): boolean =>
  action === TriggerAction.SEND_EMAIL ||
  action === TriggerAction.SEND_SLACK_MESSAGE ||
  action === TriggerAction.SEND_WEBHOOK;
