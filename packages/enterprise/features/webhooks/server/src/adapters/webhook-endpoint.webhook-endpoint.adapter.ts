import type {
  CreateWebhookEndpointCommand,
  UpdateWebhookEndpointCommand,
  WebhookDeliveryOutcome,
  WebhookEndpointView,
} from "@langwatch/enterprise-webhooks-contract";
import type { WebhookIdPort } from "../ports/webhook-id.port";
import type { WebhookSecretPort } from "../ports/webhook-secret.port";
import { PrismaWebhookEndpointRepository } from "../repositories/prisma/prisma.webhook-endpoint.repository";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service";
import type { WebhookEndpointConfiguration } from "../services/webhook-endpoint-policy.service";

export type WebhookEndpointServiceOptions = {
  prisma: unknown;
  ids: WebhookIdPort;
  secrets: WebhookSecretPort;
  configuration?: WebhookEndpointConfiguration;
  pruneDeliveries?: (now: Date) => Promise<number>;
  notifyAutoDisabled?: (input: {
    organizationId: string;
    endpointId: string;
    destination: string;
    failingSince: Date;
  }) => Promise<void>;
};

export type WebhookEndpointStatusSnapshot = {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

export interface WebhookEndpointRuntime {
  create(input: CreateWebhookEndpointCommand): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  getAll(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  getById(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  update(input: UpdateWebhookEndpointCommand): Promise<WebhookEndpointView>;
  rollSecret(input: { organizationId: string; endpointId: string; now?: Date }): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  enable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  disable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  archive(input: { organizationId: string; endpointId: string }): Promise<void>;
  getDeliverable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView | null>;
  getDestinationConfig(input: { organizationId: string; endpointId: string }): Promise<WebhookDestinationConfig>;
  getSigningSecret(input: { organizationId: string; endpointId: string }): Promise<string>;
  getSigningSecrets(input: { organizationId: string; endpointId: string; now?: Date }): Promise<string[]>;
  getStatusSnapshot(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointStatusSnapshot | null>;
  getDeliveryStats(input: { organizationId: string; endpointId: string; since: Date; sampleLimit: number }): Promise<{ attempted: number; delivered: number; latencies: number[] }>;
  getActiveByOrganization(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  organizationIdsWithActiveEndpoints(): Promise<string[]>;
  recordDeliveryAttempt(input: {
    organizationId: string;
    endpointId: string;
    dispatchId: string;
    attempt: number;
    eventCount: number;
    outcome: WebhookDeliveryOutcome;
    responseStatus?: number;
    latencyMs?: number;
    error?: string;
    response?: unknown;
    now?: Date;
  }): Promise<void>;
  getDeliveries(input: {
    organizationId: string;
    endpointId: string;
    limit?: number;
    cursor?: { firedAt: Date; id: string };
  }): Promise<{
    deliveries: Array<{
      id: string;
      dispatchId: string;
      attempt: number;
      eventCount: number;
      outcome: WebhookDeliveryOutcome;
      responseStatus: number | null;
      latencyMs: number | null;
      error: string | null;
      firedAt: Date;
    }>;
    nextCursor: { firedAt: Date; id: string } | null;
  }>;
  health(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointStatusSnapshot>;
  pruneDeliveries(now?: Date): Promise<number>;
}

export class WebhookEndpointAdapter {
  private constructor() {}

  static create(options: WebhookEndpointServiceOptions): WebhookEndpointRuntime {
    return PrismaWebhookEndpointRepository.create(options);
  }
}
