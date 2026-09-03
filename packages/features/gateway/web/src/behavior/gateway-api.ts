/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `governance-api.ts`
 * says of its own map: the procedures live in `@langwatch/gateway-server`,
 * `@langwatch/enterprise-governance-server` and `@langwatch/enterprise-webhook-server`,
 * none of which a web package may import even for a type, and the router type
 * does not exist until a process instantiates it. Emitting this file from the
 * mounted router is the fix; writing it by hand is the interim, and it is honest
 * only because the payload types below are the contract's wherever the contract
 * has them.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `virtualKeys`, `gatewayBudgets` and the
 * rest are mount points on the root router, and tRPC hashes that path into the
 * React Query cache key; spell one differently and these hooks quietly stop
 * sharing a cache with the `api.virtualKeys.*` call sites that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. It buys a content-faithful move:
 * every `api.x.y.useQuery(...)` call site in the ten screens is the line it was
 * in `platform/app`. Replacing it means a port per procedure and a rewrite of
 * six thousand lines, which is a different change from a move. Recorded here so
 * the finding it raises is a decision rather than a surprise.
 *
 * DATE, STRING OR NUMBER IS NOT A CHOICE THIS FILE MAKES. The gateway routers
 * disagree with each other about how a timestamp reaches the browser, and the
 * disagreement is what the screens already render against: `virtualKeys`,
 * `gatewayBudgets` and `gatewayCacheRules` project through a DTO that calls
 * `.toISOString()`, so those fields are STRINGS; `gatewayGuardrails`,
 * `gatewaySpendEvents` and `webhookEndpoints` return the stored resource, so
 * theirs are DATES over superjson; `routingPolicy` returns epoch NUMBERS
 * (`createdAtMs`). Every entry below states which, because getting it wrong
 * typechecks in this file and fails at the call site.
 *
 * ADD A PROCEDURE when a hook in this package needs one. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  GatewayApplicableBudget,
  GatewayBudgetLedgerStatus,
  GatewayBudgetScopeTarget,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
  GatewayCacheRuleAction,
  GatewayCacheRuleMatchers,
  GatewayGuardrailResource,
  GatewayVirtualKeyDirectBudget,
  VirtualKeyApiScopeAssignment,
  VirtualKeyConfig,
} from "@langwatch/gateway-contract";
import type { TierTargetSuggestion } from "@langwatch/model-provider-contract";

/** An acknowledgement, for the writes whose only answer is that they happened. */
export type GatewayAcknowledgement = { ok: boolean };

/** The scope triad a gateway resource is reachable from. */
export type GatewayScopeAssignment = VirtualKeyApiScopeAssignment;

/**
 * A VirtualKey as the wire carries it, which is not the row the server holds.
 *
 * `toCamelDto` drops the hashed secret, stringifies the `BigInt` revision and
 * calls `.toISOString()` on every instant, and adds two fields the column set
 * has no equivalent for: `traceProjectArchived`, true when the destination the
 * key points at is no longer live, and the `principalUser` display pair.
 *
 * DELIBERATELY NOT NAMED `VirtualKey`. The stored row is a different shape and
 * a consumer holding both would have two meanings for one word.
 */
export type VirtualKeyView = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "disabled" | "revoked";
  purpose: "user" | "langy";
  displayPrefix: string;
  principalUserId: string | null;
  traceProjectId: string | null;
  traceProjectArchived: boolean;
  principalUser: { name: string | null; email: string | null } | null;
  externalId: string | null;
  metadata: Record<string, string>;
  scopes: GatewayScopeAssignment[];
  routingPolicyId: string | null;
  routingMode: "NONE" | "FALLBACK_ALL" | "POLICY";
  config: unknown;
  /** The row's optimistic-concurrency counter, a BigInt stringified. */
  revision: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
};

/** A key together with its secret, which the two mutations that mint one return exactly once. */
export type VirtualKeyMinted = { virtualKey: VirtualKeyView; secret: string };

/**
 * The budget a key carries on itself, as the create and edit drawers send it.
 *
 * Not the contract's `GatewayBudgetResource`: this is the nested input the
 * virtual-key writes accept, which the service turns into a budget row.
 */
export type VirtualKeyBudgetInput = {
  /** A decimal string, greater than zero. */
  limitUsd: string;
  window: "DAY" | "WEEK" | "MONTH";
  onBreach?: "BLOCK" | "WARN";
  name?: string;
};

/**
 * The writable half of a key's config.
 *
 * Every field of `virtualKeyConfigSchema` carries a default, so the parsed
 * output has them all and the INPUT has none of them — which is why this is
 * spelled out rather than being `Partial<VirtualKeyConfig>`.
 */
export type VirtualKeyConfigInput = {
  modelsAllowed?: string[] | null;
  providersAllowed?: string[] | null;
  cache?: { mode?: "respect" | "force" | "disable"; ttlS?: number };
  fallback?: { maxAttempts?: number };
  guardrailAttachments?: {
    direction: "pre" | "post" | "stream_chunk";
    guardrailIds?: string[];
  }[];
  rateLimits?: { rpm?: number | null; tpm?: number | null; rpd?: number | null };
  realtime?: { maxOpenSessions?: number | null };
  metadata?: { label?: string; tags?: string[] };
};

/** The parsed config, for the surfaces that read a key back. */
export type VirtualKeyConfigView = VirtualKeyConfig;

/**
 * A GatewayBudget as the wire carries it.
 *
 * `toDto` recomputes `currentPeriodStartedAt` and `resetsAt` for the window the
 * reader is in — a stored period that has rolled is not what the page should
 * print — stringifies the two `Decimal` money columns, and drops `updatedAt`,
 * `createdById`, `managedByVirtualKeyId`, `externalId` and `metadata`.
 */
export type GatewayBudgetView = {
  id: string;
  organizationId: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  name: string;
  description: string | null;
  window: GatewayBudgetWindow;
  onBreach: "BLOCK" | "WARN";
  limitUsd: string;
  spentUsd: string;
  timezone: string | null;
  providerKey: string | null;
  currentPeriodStartedAt: string;
  resetsAt: string;
  cycleAnchorAt: string | null;
  lastResetAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  endUsersSeen: number | null;
  endUsersOver: number | null;
};

/**
 * A budget in a list, with the two facts a list has to state and a detail page
 * does not: whether spend could be totalled at all, and whether any key can
 * actually reach the scope it targets.
 */
export type GatewayBudgetListRow = GatewayBudgetView & {
  spendAvailable: boolean;
  unreachableByAnyKey: boolean;
  scopeTarget: GatewayBudgetScopeTarget | null;
  providerLabel: string | null;
};

export type GatewayBudgetList = {
  /** False when the spend source is not configured: unknown, not zero. */
  spendAvailable: boolean;
  budgets: GatewayBudgetListRow[];
};

export type GatewayBudgetDetail = GatewayBudgetView & {
  spendAvailable: boolean;
  unreachableByAnyKey: boolean;
  scopeTarget: GatewayBudgetScopeTarget;
  providerLabel: string | null;
  recentLedger: {
    id: string;
    virtualKeyId: string;
    virtualKeyName: string;
    virtualKeyPrefix: string;
    amountUsd: string;
    model: string;
    status: GatewayBudgetLedgerStatus;
    occurredAt: string;
  }[];
};

/** What a new budget is pointed at. `ATTRIBUTED_USER` is not offered on the wire. */
export type GatewayBudgetScopeInput =
  | { kind: "ORGANIZATION"; organizationId: string }
  | { kind: "TEAM"; teamId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "VIRTUAL_KEY"; virtualKeyId: string }
  | { kind: "PRINCIPAL"; principalUserId: string }
  | { kind: "GROUP"; groupId: string };

/**
 * A cache rule as the wire carries it.
 *
 * `mode` is renamed `modeEnum` by the DTO — the stored column and the `action`
 * both carry a mode, and the two are spelled differently on purpose.
 */
export type GatewayCacheRuleView = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  matchers: GatewayCacheRuleMatchers;
  action: GatewayCacheRuleAction;
  modeEnum: "RESPECT" | "FORCE" | "DISABLE";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One gateway request, as the billing feed records it. `occurredAt` is a Date. */
export type GatewaySpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  /** Always empty; kept so the row shape is stable across the two readers. */
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  costNanoUsd: number;
  costUsd: string;
  rateVersion: string;
  status: "admitted" | "confirmed" | "failed" | "settled";
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Date;
};

export type GatewaySpendEventCursor = { occurredAtMs: number; gatewayRequestId: string };

export type GatewaySpendEventFilters = {
  virtualKeyIds?: string[];
  endUserIds?: string[];
  principalUserIds?: string[];
  models?: string[];
  providerKeys?: string[];
  requestTypes?: string[];
  labels?: string[];
  metadata?: { key: string; values: string[] }[];
  status?: "success" | "error" | "admitted" | "confirmed" | "failed" | "settled";
};

/**
 * A page of spend events.
 *
 * `clickHouseDisabled` rather than a thrown error: a deployment with no spend
 * source has no events rather than a broken page, and the page says so.
 */
export type GatewaySpendEventPage = {
  rows: GatewaySpendEventRow[];
  nextCursor: GatewaySpendEventCursor | null;
  virtualKeyNames: Record<string, string>;
  clickHouseDisabled: boolean;
};

export type GatewayUsageSummary = {
  totalUsd: string;
  totalRequests: number;
  blockedRequests: number;
  avgUsdPerRequest: string;
  byVirtualKey: {
    virtualKeyId: string;
    name: string;
    displayPrefix: string;
    totalUsd: string;
    requests: number;
  }[];
  byModel: { model: string; totalUsd: string; requests: number }[];
  byDay: { day: string; totalUsd: string; requests: number }[];
};

export type GatewayVirtualKeyUsageSummary = {
  totalUsd: string;
  totalRequests: number;
  blockedRequests: number;
  avgUsdPerRequest: string;
  byModel: { model: string; totalUsd: string; requests: number }[];
  byDay: { day: string; totalUsd: string; requests: number }[];
  /** The most recent twenty, which is what the detail page shows. */
  recentDebits: {
    id: string;
    occurredAt: string;
    model: string;
    providerSlot: string | null;
    amountUsd: string;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number | null;
    status: string;
  }[];
};

export type RoutingPolicyScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** A routing policy. Its instants are epoch milliseconds, not Dates. */
export type RoutingPolicyView = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  modelProviderIds: string[];
  modelAliases: Record<string, string>;
  defaultModel: string | null;
  policyRules: Record<string, unknown>;
  isDefault: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  createdById: string | null;
  updatedById: string | null;
  scopes: { scopeType: RoutingPolicyScopeType; scopeId: string }[];
};

/**
 * A configured SQS destination as the endpoint list renders it.
 *
 * `region`, `accountId` and `queueName` are parsed out of the queue URL by the
 * server, because every Amazon SQS URL opens with the same host and the table
 * would otherwise print an identical string on every row.
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
  disabledAt: Date | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WebhookEndpointHealth = {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  oldestUndeliveredAgeMs: number | null;
  dlqDepth: number;
  sendsPerMinute: number;
  successRate: number | null;
  p95LatencyMs: number | null;
};

/**
 * One event a webhook endpoint can subscribe to.
 *
 * Restated rather than imported: the catalogue is
 * `@langwatch/enterprise-webhook-contract`'s, and this is a core package — a
 * core-to-enterprise dependency is exactly the direction the manifest check
 * refuses. The shape is five fields, the router returns it verbatim, and the
 * drawer only reads it.
 */
export type WebhookEventType = {
  type: string;
  family: string;
  schemaVersion: "1";
  isEmitting: boolean;
  description: string;
};

export type WebhookDeliveryCursor = { firedAt: Date | string; id: string };

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
    firedAt: Date;
  }[];
  nextCursor: { firedAt: Date; id: string } | null;
};

export type WebhookSqsInput = {
  queueUrl: string;
  roleArn?: string | null;
  externalId?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
};

/**
 * A model provider as the organization-wide list renders it.
 *
 * NOT the contract's `LegacyModelProvider`: the router maps through its own
 * projection, which is narrower and spells `customModels` differently. The
 * shape below is that projection.
 */
export type OrganizationModelProviderView = {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  disabledAt: Date | null;
  healthStatus: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN" | null;
  customKeys: Record<string, unknown> | null;
  /** Always null on this projection. */
  deploymentMapping: null;
  scopes: GatewayScopeAssignment[];
  models: string[] | null;
  embeddingsModels: string[] | null;
  customModels: { modelId: string; displayName: string; mode: "chat" }[];
  customEmbeddingsModels: { modelId: string; displayName: string; mode: "embedding" }[];
};

/**
 * A monitor, narrowed to the five fields the guardrails page reads.
 *
 * The procedure returns `MonitorWithEvaluator` from `@langwatch/monitor-contract`,
 * a much wider row with its own evaluator relation. Declaring the narrow shape
 * is safe — a query output is only ever read — and it keeps this package from
 * taking a dependency on a foreign feature's contract for five fields.
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
 * An organization member, narrowed to what the budget drawer names them by.
 *
 * The procedure returns the whole `User` scalar row, PII included. Narrowing
 * here is not cosmetic: it is what stops a later edit reaching for a column
 * this package has no business rendering.
 */
export type OrganizationMemberView = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * One organization as the section reads it: its own row plus its teams.
 *
 * The same shape the host port publishes, restated here because a behavior
 * module may not import a screen's public boundary and the port lives in
 * `model`. Kept in step by the adapter that maps one onto the other.
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
      apiKey: string;
      createdAtMs: number;
    };
    created: boolean;
  };
  routingPolicy: { id: string; name: string } | null;
};

export type GatewayApiMap = {
  virtualKeys: {
    list: {
      query: { input: { organizationId: string }; output: VirtualKeyView[] };
    };
    get: {
      query: { input: { organizationId: string; id: string }; output: VirtualKeyView };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          description?: string;
          principalUserId?: string | null;
          scopes: GatewayScopeAssignment[];
          traceProjectId?: string | null;
          routingPolicyId?: string | null;
          routingMode?: "NONE" | "FALLBACK_ALL" | "POLICY";
          /** Coerced server-side, so a form may send either. */
          expiresAt?: Date | string;
          budget?: VirtualKeyBudgetInput | null;
          config?: VirtualKeyConfigInput;
        };
        output: VirtualKeyMinted;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          scopes?: GatewayScopeAssignment[];
          traceProjectId?: string | null;
          routingPolicyId?: string | null;
          routingMode?: "NONE" | "FALLBACK_ALL" | "POLICY";
          expiresAt?: Date | string | null;
          budget?: VirtualKeyBudgetInput | null;
          config?: VirtualKeyConfigInput;
        };
        output: VirtualKeyView;
      };
    };
    disable: {
      mutation: {
        input: { organizationId: string; id: string; reason?: string };
        output: VirtualKeyView;
      };
    };
    enable: {
      mutation: { input: { organizationId: string; id: string }; output: VirtualKeyView };
    };
    revoke: {
      mutation: { input: { organizationId: string; id: string }; output: VirtualKeyView };
    };
    rotate: {
      mutation: { input: { organizationId: string; id: string }; output: VirtualKeyMinted };
    };
    applicableBudgets: {
      query: {
        input: {
          organizationId: string;
          virtualKeyId?: string | null;
          scopes: GatewayScopeAssignment[];
          traceProjectId?: string | null;
          principalUserId?: string | null;
        };
        output: GatewayApplicableBudget[];
      };
    };
    spendThisMonth: {
      query: {
        input: { organizationId: string };
        output: {
          virtualKeyId: string;
          spentUsd: string;
          requests: number;
          budget: GatewayVirtualKeyDirectBudget | null;
        }[];
      };
    };
  };

  gatewayBudgets: {
    list: {
      query: { input: { organizationId: string }; output: GatewayBudgetList };
    };
    /**
     * Declared because a mutation invalidates it, not because this package
     * reads it: the personal-workspace budget list is `platform/app`'s, and an
     * invalidation only reaches it while both halves name the same path.
     */
    listForProject: {
      query: { input: { projectId: string }; output: GatewayBudgetList };
    };
    get: {
      query: {
        input: { organizationId: string; id: string };
        output: GatewayBudgetDetail;
      };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          scope: GatewayBudgetScopeInput;
          name: string;
          description?: string;
          window: GatewayBudgetWindow;
          limitUsd: number | string;
          onBreach?: "BLOCK" | "WARN";
          timezone?: string | null;
          providerKey?: string | null;
          /** An ISO string here must carry an offset. */
          cycleAnchorAt?: Date | string | null;
          /** Saves a budget no key can reach, once the reader has been told. */
          allowUnreachable?: boolean;
        };
        output: GatewayBudgetView;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          limitUsd?: number | string;
          onBreach?: "BLOCK" | "WARN";
          timezone?: string | null;
        };
        output: GatewayBudgetView;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GatewayBudgetView;
      };
    };
    reset: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          endUserId?: string;
          reason?: string;
        };
        output: GatewayBudgetView;
      };
    };
    groupTargets: {
      query: {
        input: { organizationId: string };
        output: readonly { id: string; name: string; memberCount: number }[];
      };
    };
  };

  gatewayCacheRules: {
    list: {
      query: { input: { organizationId: string }; output: GatewayCacheRuleView[] };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          description?: string | null;
          priority?: number;
          enabled?: boolean;
          matchers: GatewayCacheRuleMatchers;
          action: GatewayCacheRuleAction;
        };
        output: GatewayCacheRuleView;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          priority?: number;
          enabled?: boolean;
          matchers?: GatewayCacheRuleMatchers;
          action?: GatewayCacheRuleAction;
        };
        output: GatewayCacheRuleView;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GatewayCacheRuleView;
      };
    };
  };

  /** Guardrails are PROJECT-scoped; every other gateway resource is not. */
  gatewayGuardrails: {
    list: {
      query: { input: { projectId: string }; output: GatewayGuardrailResource[] };
    };
    create: {
      mutation: {
        input: {
          projectId: string;
          name: string;
          description?: string | null;
          evaluatorId: string;
          direction: "PRE" | "POST" | "STREAM_CHUNK";
          failureMode?: "FAIL_OPEN" | "FAIL_CLOSED";
        };
        output: GatewayGuardrailResource;
      };
    };
    update: {
      mutation: {
        input: {
          projectId: string;
          id: string;
          name?: string;
          description?: string | null;
          evaluatorId?: string;
          direction?: "PRE" | "POST" | "STREAM_CHUNK";
          failureMode?: "FAIL_OPEN" | "FAIL_CLOSED";
        };
        output: GatewayGuardrailResource;
      };
    };
    archive: {
      mutation: {
        input: { projectId: string; id: string };
        output: GatewayAcknowledgement;
      };
    };
  };

  gatewaySpendEvents: {
    list: {
      query: {
        input: {
          projectId: string;
          fromMs: number;
          toMs: number;
          filters?: GatewaySpendEventFilters;
          cursor?: GatewaySpendEventCursor;
          limit?: number;
        };
        output: GatewaySpendEventPage;
      };
    };
  };

  gatewayUsage: {
    summary: {
      query: {
        /** Both bounds are ISO strings, not Dates. */
        input: { organizationId: string; fromDate: string; toDate: string };
        output: GatewayUsageSummary;
      };
    };
    summaryForVirtualKey: {
      query: {
        input: {
          organizationId: string;
          virtualKeyId: string;
          fromDate: string;
          toDate: string;
          model?: string;
        };
        output: GatewayVirtualKeyUsageSummary;
      };
    };
  };

  routingPolicy: {
    list: {
      query: {
        input: {
          organizationId: string;
          selectableForScope?: { scopeType: RoutingPolicyScopeType; scopeId: string };
        };
        output: RoutingPolicyView[];
      };
    };
    get: {
      query: {
        input: { organizationId: string; id: string };
        output: RoutingPolicyView;
      };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          scopes: { scopeType: RoutingPolicyScopeType; scopeId: string }[];
          name: string;
          description?: string | null;
          modelProviderIds: string[];
          isDefault?: boolean;
          modelAliases?: Record<string, string>;
          defaultModel?: string | null;
          policyRules?: Record<string, unknown>;
        };
        output: RoutingPolicyView;
      };
    };
    /** Deliberately no `scopes` and no `isDefault`: both move a policy, and moving one is its own write. */
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          modelProviderIds?: string[];
          modelAliases?: Record<string, string>;
          defaultModel?: string | null;
          policyRules?: Record<string, unknown>;
        };
        output: RoutingPolicyView;
      };
    };
    setDefault: {
      mutation: {
        input: { organizationId: string; id: string };
        output: RoutingPolicyView;
      };
    };
    delete: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GatewayAcknowledgement;
      };
    };
    tierSuggestions: {
      query: {
        input: {
          organizationId: string;
          tier: "complex" | "reasoning" | "fast";
          boundProviderTypes?: string[];
        };
        output: TierTargetSuggestion[];
      };
    };
  };

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
        output: void;
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
     *
     * Read by the frontend feature that mounts these screens rather than by a
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per
     * document however many halves of the product want it.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: GatewayOrganizationGraph[];
      };
    };
  };

  user: {
    personalContext: {
      query: { input: { organizationId: string }; output: PersonalWorkspaceContext };
    };
  };

  limits: {
    /**
     * The organization's plan, narrowed to the two facts a gateway surface asks
     * of it. The procedure answers with a far wider usage report; nothing here
     * renders the rest, so nothing here declares it.
     */
    getUsage: {
      query: {
        input: { organizationId: string };
        output: {
          activePlan: {
            type: string;
            /** Absent on a legacy plan row, which is not the same as false. */
            webhookEndpointsEnabled?: boolean;
          };
        };
      };
    };
  };
};

/**
 * The gateway's typed tRPC hooks. Same machinery, same transport and same React
 * Query cache as the application's `api` proxy — see `createFeatureApi` for why
 * separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other
 * packages call the hooks. It is exported from `screens/gateway` only so the
 * process shell can mount `gatewayApi.Provider`.
 */
export const gatewayApi = createFeatureApi<GatewayApiMap>();

/**
 * Every procedure's output, addressed the way the screens already address it.
 *
 * The application's `~/utils/api` exported `RouterOutputs` off the real
 * `AppRouter`, and the screens wrote `RouterOutputs["webhookEndpoints"]["list"][number]`.
 * Deriving the same shape from the map above keeps those type aliases exactly
 * as they were written, and keeps them honest: an output that changes here
 * changes at every alias, which is what a generated map will do too.
 */
type GatewayOutputOf<TNode> = TNode extends { query: { output: infer TOutput } }
  ? TOutput
  : TNode extends { mutation: { output: infer TOutput } }
    ? TOutput
    : { [TSegment in keyof TNode]: GatewayOutputOf<TNode[TSegment]> };

export type RouterOutputs = {
  [TSegment in keyof GatewayApiMap]: GatewayOutputOf<GatewayApiMap[TSegment]>;
};

/**
 * The name the screens call it by.
 *
 * They were written against the application's `api` proxy and are moved
 * unchanged; the import line is what tells them which one they have.
 */
export const api = gatewayApi;
