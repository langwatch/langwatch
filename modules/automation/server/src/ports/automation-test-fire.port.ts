import type { SlackPayload } from "@langwatch/automation-contract";

export interface TestFireEmail {
  recipients: string[];
  subject: string;
  html: string;
}

export interface TestFireSlackWebhook {
  webhook: string;
  payload: SlackPayload;
}

export interface TestFireSlackBot {
  token: string;
  channel: string;
  payload: SlackPayload;
}

export interface TestFireWebhook {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers: Record<string, string>;
  signingSecrets?: readonly string[];
  body: string;
  triggerName: string;
}

export abstract class AutomationTestFirePort {
  abstract sendEmail(input: TestFireEmail): Promise<void>;
  abstract sendSlack(input: TestFireSlackWebhook): Promise<void>;
  abstract sendSlackBot(input: TestFireSlackBot): Promise<void>;
  abstract sendWebhook(input: TestFireWebhook): Promise<{ status: number }>;
}
