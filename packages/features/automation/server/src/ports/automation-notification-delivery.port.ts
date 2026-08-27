import type { AlertType, SlackPayload } from "@langwatch/automation-contract";
import type {
  WebhookDeliveryRequest,
  WebhookSendResult,
} from "../adapters/webhook-delivery.adapter";
import type { TraceRecord } from "@langwatch/trace-contract";

/** Outbound provider calls. Automation owns when and what to send; the process
 * adapter owns SDKs, HTTP policy, mail rendering infrastructure, and secrets. */
export abstract class AutomationNotificationDeliveryPort {
  /** The established transactional-mail renderer remains a host delivery
   * adapter; Automation decides when a legacy digest is sent. */
  abstract sendLegacyEmail(input: {
    recipients: string[];
    triggerData: Array<{
      traceId: string;
      input: string;
      output: string;
      projectId: string;
      fullTrace: TraceRecord;
    }>;
    triggerName: string;
    triggerId: string;
    projectId: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void>;

  abstract sendEmail(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void>;

  abstract sendSlackWebhook(input: {
    webhook: string;
    triggerName: string;
    payload: SlackPayload;
  }): Promise<void>;

  abstract sendLegacySlackWebhook(input: {
    webhook: string;
    triggerData: Array<{
      traceId: string;
      input: string;
      output: string;
      projectId: string;
      fullTrace: TraceRecord;
    }>;
    triggerName: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    baseHost: string;
  }): Promise<void>;

  abstract sendSlackBot(input: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  }): Promise<void>;

  abstract sendWebhook(input: WebhookDeliveryRequest): Promise<WebhookSendResult>;
}
