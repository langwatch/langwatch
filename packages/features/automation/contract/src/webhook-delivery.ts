export const WEBHOOK_DELIVERY_OUTCOMES = [
  "success",
  "retryable",
  "terminal",
  "pending",
] as const;
export type WebhookDeliveryOutcome = (typeof WEBHOOK_DELIVERY_OUTCOMES)[number];

export type WebhookFailureResponse = {
  body?: string;
  headers?: Record<string, string>;
  retryAfterMs?: number;
};

export type WebhookDeliveryRow = {
  id: string;
  triggerId: string;
  dispatchId: string;
  responseStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  response: WebhookFailureResponse | null;
  outcome: WebhookDeliveryOutcome;
  firedAt: Date;
};

export type WebhookDeliveryInput = {
  projectId: string;
  triggerId: string;
  dispatchId: string;
  responseStatus?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  response?: WebhookFailureResponse | null;
  outcome: WebhookDeliveryOutcome;
};
