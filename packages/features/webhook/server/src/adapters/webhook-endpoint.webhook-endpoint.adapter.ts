import type {
  CreateWebhookEndpointCommand,
  UpdateWebhookEndpointCommand,
  WebhookDeliveryOutcome,
  WebhookEndpointView,
} from "@langwatch/webhook-contract";
import type { Instant } from "@langwatch/time";
import type { WebhookIdPort } from "../ports/webhook-id.port.ts";
import type { WebhookSecretPort } from "../ports/webhook-secret.port.ts";
import {
  PrismaWebhookEndpointRepository,
  type WebhookEndpointDatabase,
} from "../repositories/prisma/prisma.webhook-endpoint.repository.ts";
import type { WebhookDestinationConfig } from "../services/webhook-destination.service.ts";
import type { WebhookEndpointConfiguration } from "../services/webhook-endpoint-policy.service.ts";

export type WebhookEndpointServiceOptions = {
  prisma: WebhookEndpointDatabase;
  ids: WebhookIdPort;
  secrets: WebhookSecretPort;
  configuration?: WebhookEndpointConfiguration;
  pruneDeliveries?: (now: Instant) => Promise<number>;
  notifyAutoDisabled?: (input: {
    organizationId: string;
    endpointId: string;
    destination: string;
    failingSince: Instant;
  }) => Promise<void>;
};

export type WebhookEndpointStatusSnapshot = {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Instant | null;
  lastSuccessAt: Instant | null;
  lastFailureAt: Instant | null;
};

export interface WebhookEndpointRuntime {
  create(
    input: CreateWebhookEndpointCommand,
  ): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  getAll(input: { organizationId: string }): Promise<WebhookEndpointView[]>;
  getById(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  update(input: UpdateWebhookEndpointCommand): Promise<WebhookEndpointView>;
  rollSecret(input: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<{ endpoint: WebhookEndpointView; secret: string }>;
  enable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  disable(input: { organizationId: string; endpointId: string }): Promise<WebhookEndpointView>;
  archive(input: { organizationId: string; endpointId: string }): Promise<void>;
  tryGetDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointView | null>;
  getDestinationConfig(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookDestinationConfig>;
  getSigningSecret(input: { organizationId: string; endpointId: string }): Promise<string>;
  getSigningSecrets(input: {
    organizationId: string;
    endpointId: string;
    now?: Instant;
  }): Promise<string[]>;
  tryGetStatusSnapshot(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointStatusSnapshot | null>;
  getDeliveryStats(input: {
    organizationId: string;
    endpointId: string;
    since: Instant;
    sampleLimit: number;
  }): Promise<{ attempted: number; delivered: number; latencies: number[] }>;
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
    now?: Instant;
  }): Promise<void>;
  getDeliveries(input: {
    organizationId: string;
    endpointId: string;
    limit?: number;
    cursor?: { firedAt: Instant; id: string };
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
      firedAt: Instant;
    }>;
    nextCursor: { firedAt: Instant; id: string } | null;
  }>;
  health(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointStatusSnapshot>;
  pruneDeliveries(now?: Instant): Promise<number>;
}

export class WebhookEndpointAdapter {
  private constructor() {}

  static create(options: WebhookEndpointServiceOptions): WebhookEndpointRuntime {
    return PrismaWebhookEndpointRepository.create(options);
  }
}
