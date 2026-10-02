/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 */

import { type ContractApiMap, createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
import type { routingPolicyTrpc } from "@langwatch/enterprise-gateway-contract";
import type {
  gatewayBudgetTrpc,
  gatewayCacheRuleTrpc,
  gatewayGuardrailTrpc,
  gatewaySpendEventTrpc,
  gatewayUsageTrpc,
  VirtualKeyApiScopeAssignment,
  virtualKeyTrpc,
} from "@langwatch/gateway-contract";

/**
 * A configured SQS destination as the endpoint list renders it. `region`, `accountId` and
 * `queueName` are parsed out of the queue URL by the server, because every Amazon SQS URL opens
 * with the same host and the table would otherwise print an identical string on every row.
 */
export type WebhookDestinationView = {
  queueUrl: string;
  region: string;
  accountId: string;
  queueName: string;
  credentialMode: "assume_role" | "static" | "ambient";
  roleArn: string | null;
  externalId: string | null;
  /** The stored key id, never the secret. */
  accessKeyId: string | null;
};

/** A webhook endpoint. Its instants are Dates. */
export type WebhookEndpointView = {
  id: string;
  organizationId: string;
  destinationKind: "http" | "sqs";
  url: string | null;
  sqs: WebhookDestinationView | null;
  enabledEvents: string[];
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  disabledAt: string | null;
  failingSince: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  createdAt: string;
  updatedAt: string;
};

export type WebhookEndpointHealth = {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  oldestUndeliveredAgeMs: number | null;
  dlqDepth: number;
  sendsPerMinute: number;
  successRate: number | null;
  p95LatencyMs: number | null;
};

/**
 * One event a webhook endpoint can subscribe to. Restated rather than imported: the catalogue
 * is `@langwatch/webhook-contract`'s, and this is a core package — a
 * core-to-enterprise dependency is exactly the direction the manifest check refuses.
 */
export type WebhookEventType = {
  type: string;
  family: string;
  schemaVersion: "1";
  isEmitting: boolean;
  description: string;
};

export type WebhookDeliveryCursor = { firedAt: string; id: string };

export type WebhookDeliveryPage = {
  deliveries: {
    id: string;
    dispatchId: string;
    attempt: number;
    eventCount: number;
    outcome: "success" | "retryable" | "terminal";
    responseStatus: number | null;
    latencyMs: number | null;
    error: string | null;
    /** ISO 8601: the wire carries the instant as text. */
    firedAt: string;
  }[];
  nextCursor: { firedAt: string; id: string } | null;
};

export type WebhookSqsInput = {
  queueUrl: string;
  roleArn?: string | null;
  externalId?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
};

/**
 * A model provider as the organization-wide list renders it. NOT the contract's
 * `LegacyModelProvider`: the router maps through its own projection, which is narrower and
 * spells `customModels` differently. The shape below is that projection.
 */
export type OrganizationModelProviderView = {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  disabledAt: string | null;
  healthStatus: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN" | null;
  customKeys: Record<string, unknown> | null;
  /** Always null on this projection. */
  deploymentMapping: null;
  scopes: VirtualKeyApiScopeAssignment[];
  models: string[] | null;
  embeddingsModels: string[] | null;
  customModels: { modelId: string; displayName: string; mode: "chat" }[];
  customEmbeddingsModels: { modelId: string; displayName: string; mode: "embedding" }[];
};

/**
 * A monitor, narrowed to the five fields the guardrails page reads. The procedure returns
 * `MonitorWithEvaluator` from `@langwatch/monitor-contract`, a much wider row with its own
 * evaluator relation.
 */
export type GuardrailEligibleMonitor = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  executionMode: string | null;
  evaluatorId: string | null;
};

/**
 * An organization member, narrowed to what the budget drawer names them by. The procedure
 * returns the whole `User` scalar row, PII included. Narrowing here is not cosmetic: it is what
 * stops a later edit reaching for a column this package has no business rendering.
 */
export type OrganizationMemberView = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * One organization as the section reads it: its own row plus its teams. The same shape the host
 * port publishes, restated here because a behavior module may not import a screen's public
 * boundary and the port lives in `model`.
 */
export type GatewayOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  teams: {
    id: string;
    name: string;
    projects: { id: string; name: string; slug: string }[];
  }[];
};

export type PersonalWorkspaceContext = {
  workspace: {
    team: { id: string; name: string; slug: string; createdAtMs: number };
    project: {
      id: string;
      name: string;
      slug: string;
      createdAtMs: number;
    };
    created: boolean;
  };
  routingPolicy: { id: string; name: string } | null;
};

export type GatewayApiMap = ContractApiMap<typeof routingPolicyTrpc> &
  ContractApiMap<typeof virtualKeyTrpc> &
  ContractApiMap<typeof gatewayBudgetTrpc> &
  ContractApiMap<typeof gatewayCacheRuleTrpc> &
  ContractApiMap<typeof gatewayGuardrailTrpc> &
  ContractApiMap<typeof gatewaySpendEventTrpc> &
  ContractApiMap<typeof gatewayUsageTrpc> & {
    webhookEndpoints: {
      list: {
        query: { input: { organizationId: string }; output: WebhookEndpointView[] };
      };
      create: {
        mutation: {
          input: {
            organizationId: string;
            destinationKind?: "http" | "sqs";
            url?: string;
            sqs?: WebhookSqsInput;
            enabledEvents: string[];
            maxBatchSize?: number;
            maxBatchDelayMs?: number;
            maxInFlight?: number;
          };
          output: { endpoint: WebhookEndpointView; secret: string };
        };
      };
      update: {
        mutation: {
          input: {
            organizationId: string;
            endpointId: string;
            destinationKind?: "http" | "sqs";
            url?: string;
            /** A null field clears the stored credential; an absent one keeps it. */
            sqs?: Partial<WebhookSqsInput>;
            enabledEvents?: string[];
            maxBatchSize?: number;
            maxBatchDelayMs?: number;
            maxInFlight?: number;
          };
          output: WebhookEndpointView;
        };
      };
      archive: {
        mutation: {
          input: { organizationId: string; endpointId: string };
          output: undefined;
        };
      };
      enable: {
        mutation: {
          input: { organizationId: string; endpointId: string };
          output: WebhookEndpointView;
        };
      };
      disable: {
        mutation: {
          input: { organizationId: string; endpointId: string };
          output: WebhookEndpointView;
        };
      };
      rollSecret: {
        mutation: {
          input: { organizationId: string; endpointId: string };
          output: { endpoint: WebhookEndpointView; secret: string };
        };
      };
      deliveries: {
        query: {
          input: {
            organizationId: string;
            endpointId: string;
            limit?: number;
            cursor?: WebhookDeliveryCursor;
          };
          output: WebhookDeliveryPage;
        };
      };
      eventTypes: {
        query: {
          input: { organizationId: string };
          output: readonly WebhookEventType[];
        };
      };
      health: {
        query: {
          input: { organizationId: string; endpointId: string };
          output: WebhookEndpointHealth;
        };
      };
    };

    modelProvider: {
      listAllForOrganizationForFrontend: {
        query: {
          input: { organizationId: string };
          output: OrganizationModelProviderView[];
        };
      };
    };

    monitors: {
      getAllForProject: {
        query: { input: { projectId: string }; output: GuardrailEligibleMonitor[] };
      };
    };

    organization: {
      getAllOrganizationMembers: {
        query: { input: { organizationId: string }; output: OrganizationMemberView[] };
      };
      /**
       * The organization graph the section's scope is resolved out of.
       */
      getScopeGraph: {
        query: {
          input: Record<string, never>;
          output: GatewayOrganizationGraph[];
        };
      };
    };

    user: {
      personalContext: {
        query: { input: { organizationId: string }; output: PersonalWorkspaceContext };
      };
    };

    plan: {
      /** The organization's plan, narrowed to the two facts a gateway surface asks of it. */
      getActivePlan: {
        query: {
          input: { organizationId: string };
          output: {
            type: string;
            /** Absent on a legacy plan row, which is not the same as false. */
            webhookEndpointsEnabled?: boolean;
          };
        };
      };
    };
  };

/**
 * The gateway's typed tRPC hooks. Same machinery, same transport and same React Query cache as
 * the application's `api` proxy — see `createModuleApi` for why separate instances still share
 * cache entries.
 */
export const gatewayApi = createModuleApi<GatewayApiMap>();

/**
 * Every procedure's output, addressed the way the screens already address it. The application's
 * `~/utils/api` exported `RouterOutputs` off the real `AppRouter`, and the screens wrote
 * `RouterOutputs["webhookEndpoints"]["list"][number]`.
 */
export type RouterOutputs = OutputsFromMap<GatewayApiMap>;

/**
 * The name the screens call it by. They were written against the application's `api` proxy and
 * are moved unchanged; the import line is what tells them which one they have.
 */
export const api = gatewayApi;
