import type {
  SlackActionParams,
  SlackDeliveryMethod,
  SlackTemplateType,
} from "@langwatch/automation-contract";

/**
 * A template field. `usingDefault` means not customised (Reset and the default badge read it).
 * `value` is what will be sent: empty under the framework default, pre-filled for a report.
 */
export interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

/** The Slack provider's draft slice (ADR-093 §5a). */
export interface SlackSlice {
  /** The Slack connection this automation delivers through. Empty until one is picked. */
  slackIntegrationId: string;
  /** The picked connection's name, for the summary line only; never written into `actionParams`. */
  connectionName?: string;
  /** Follows the picked connection's kind: a bot posts to a channel and renders every block,
   *  a webhook posts to its own channel. */
  deliveryMethod: SlackDeliveryMethod;
  /** Bot destination channel (id like C0123, or #name). */
  channelId: string;
  /** A saved row that still carries a secret of its own and no connection; written back
   *  untouched until the author picks a connection. */
  legacyParams: Partial<SlackActionParams> | null;
  templateType: SlackTemplateType;
  template: FieldDraft;
}
