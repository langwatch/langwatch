import type { SlackPayload } from "@langwatch/automation-contract";

/**
 * The trigger id a test fire carries, so delivery can tell a preview from a
 * real fire and never pollute a bounce stream keyed on the trigger hash.
 */
export const TEST_FIRE_TRIGGER_ID_SENTINEL = "preview";

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

export abstract class AutomationTestFire {
  abstract sendEmail(input: TestFireEmail): Promise<void>;
  abstract sendSlack(input: TestFireSlackWebhook): Promise<void>;
  abstract sendSlackBot(input: TestFireSlackBot): Promise<void>;
  abstract sendWebhook(input: TestFireWebhook): Promise<{ status: number }>;
}
