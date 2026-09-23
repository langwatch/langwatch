// Hand-written governance procedures (meant to be generated).
// Segment names load-bearing (mount points, cache keys); only ADR-004 exception.

import { createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
import type {
  ActivityEventDetailRow,
  ActivityMonitorSummary,
  AgentsListingOutcome,
  AiToolEntry,
  AiToolProviderOption,
  AiToolType,
  AnomalyRule,
  AnomalyRuleScope,
  AnomalyRuleSeverity,
  AnomalyRuleStatus,
  Department,
  GovernanceIngestionSourceType,
  GovernanceSortDirection,
  IngestionSourceHealthRow,
  IngestionTemplate,
  OttlValidationResult,
  QuarantineFillStats,
  RecentAnomalyRow,
  RoutingPolicy,
  RoutingPolicyScopeType,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
  SpendSortField,
} from "@langwatch/enterprise-governance-contract";
import type * as enterpriseGovernanceContractModule from "@langwatch/enterprise-governance-contract";

// Acknowledgement for writes that return void; `.ok` is the only field read.
export type GovernanceAcknowledgement = { ok: boolean };

// Wire DTO: adds hasPollerCursor and traceProjectArchived.
// Named View not Source to avoid confusion with server row.
export type GovernanceIngestionSourceView = {
  id: string;
  organizationId: string;
  teamId: string | null;
  sourceType: string;
  name: string;
  description: string | null;
  parserConfig: Record<string, unknown>;
  hasPollerCursor: boolean;
  pullSchedule: string | null;
  status: string;
  traceProjectId: string | null;
  traceProjectArchived: boolean;
  lastEventAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  errorCount: number;
  lastRunCompleteness: "complete" | "truncated" | null;
  pullStatus: {
    lastRunAt: string | null;
    outcome: string | null;
    error: string | null;
    backfillThrough: string | null;
    hasMore: boolean | null;
  } | null;
  lastSuccessAt: string | null;
};

export type GovernanceDepartmentView = Omit<Department, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export type GovernanceAgentView = {
  id: string;
  name: string;
  environment: string | null;
  owner: string | null;
  models: string[];
  source: "copilot_studio" | "custom" | "databricks";
  costUsd30d: number | null;
  requests30d: number | null;
  lastActiveMinutesAgo: number | null;
  health: "responding" | "idle" | "erroring" | null;
  registeredDaysAgo: number | null;
};

export type GovernancePersonView = {
  id: string;
  provider: string;
  kind: string;
  displayText: string;
  rawActorId: string;
  directoryDepartment: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  erasedAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  link: {
    userId: string;
    evidenceKind: string;
    memberName: string | null;
    departmentName: string | null;
  } | null;
};

/**
 * A source together with its ingest secret, which the two mutations that mint
 * one return exactly once. Nothing reads the secret back afterwards, so the UI
 * has to surface it before it navigates away.
 */
export type GovernanceIngestionSourceCreated = {
  source: GovernanceIngestionSourceView;
  ingestSecret: string;
};

// OTTL starter: enabledSourceTypes typed string[] (unions break .includes() checks).
export type GovernanceOttlStarter = {
  enabled: boolean;
  statements: string[];
  enabledSourceTypes: string[];
};

// Actor's workspace link: displayName always filled (falls back through name, email, id).
export type GovernanceActorWorkspace = {
  userId: string;
  displayName: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
};

/** One row of the starter-pack checklist the catalog editor renders. */
export type GovernanceAiToolStarterTile = {
  slug: string;
  displayName: string;
  type: AiToolType;
};

/** What importing the starter pack did, counted by outcome. */
export type GovernanceAiToolImportResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * A routing policy as the tool-catalog drawer's dropdown needs it. The
 * procedure projects the two fields a `<select>` binds and nothing else, so
 * this is a view of `RoutingPolicy` rather than the whole of it.
 */
export type GovernanceRoutingPolicyOption = { id: string; name: string };

/** The organization's session-lifetime policy. Zero days means unbounded. */
export type GovernanceSessionPolicy = { maxSessionDurationDays: number };

/**
 * The plan an organization's usage is measured against. Restated here
 * rather than imported: it belongs to `@langwatch/entitlement-contract`, and
 * `limits` is the one procedure whose payload no governance type describes.
 */
export type GovernancePlanInfo = {
  planSource: "license" | "subscription" | "free";
  type: string;
  name: string;
  free: boolean;
  visibilityDays?: number | null;
  trialDays?: number;
  daysSinceCreation?: number;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
  canPublish: boolean;
  webhookEndpointsEnabled?: boolean;
  maxTriggerPersistDispatchesPerDay?: number;
  usageUnit?: string;
  userPrice?: { USD: number; EUR: number };
  tracesPrice?: { USD: number; EUR: number };
  prices: { USD: number; EUR: number };
};

/**
 * The limit reading with its copy already composed server-side — the same
 * number appears in the sidebar, settings page and approaching-limit email,
 * and three renderings of one number is how they start disagreeing.
 */
export type GovernanceMessageLimitInfo = {
  status: "ok" | "warning" | "exceeded";
  current: number;
  max: number;
  currentFormatted: string;
  maxFormatted: string;
  percentageFormatted: string;
  message: string;
};

/** One organization's usage for the current period, against its allowance. */
export type GovernanceUsageStats = {
  /** Null on a legacy or unlimited response, which has no count to show. */
  currentMonthMessagesCount: number | null;
  currentMonthCost: number;
  activePlan: GovernancePlanInfo;
  maxMonthlyUsageLimit: number;
  membersCount: number;
  membersLiteCount: number;
  messageLimitInfo: GovernanceMessageLimitInfo;
  usageUnit: "traces" | "events";
};

// Procedures: hand-written (meant to be generated from mounted router).
// Segment names load-bearing (mount points, cache keys); inputs are z.input, dates are ISO strings.
// Organization graph view: org, teams, projects (shares cache with app shell).
export type GovernanceOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  teams: {
    id: string;
    name: string;
    slug: string;
    projects: { id: string; name: string; slug: string }[];
  }[];
};

export type GovernanceApiMap = {
  modelProvider: {
    getResolvedDefault: {
      query: {
        input: { projectId: string; featureKey: string };
        output: { model: string | null };
      };
    };
  };
  langy: {
    modelsAllowed: {
      query: {
        input: { projectId: string };
        output: { modelsAllowed: string[] };
      };
    };
  };
  governanceAgents: {
    list: { query: { input: { organizationId: string }; output: GovernanceAgentView[] } };
    syncSources: {
      query: {
        input: { organizationId: string };
        output: {
          id: string;
          name: string;
          sourceType: string;
          lastListing: AgentsListingOutcome | null;
        }[];
      };
    };
    requestListing: {
      mutation: {
        input: { organizationId: string };
        output: { requested: number; sources: { id: string; name: string }[] };
      };
    };
  };
  governancePeople: {
    list: { query: { input: { organizationId: string }; output: GovernancePersonView[] } };
    suggestions: {
      query: {
        input: { organizationId: string };
        output: {
          id: string;
          personDisplayText: string;
          personProvider: string;
          memberName: string | null;
          userId: string;
        }[];
      };
    };
    runMatch: {
      mutation: {
        input: { organizationId: string };
        output: { linked: number; unproven: number };
      };
    };
    confirmSuggestion: {
      mutation: {
        input: { organizationId: string; suggestionId: string };
        output: GovernanceAcknowledgement;
      };
    };
  };
  activityMonitor: {
    summary: {
      query: {
        input: { organizationId: string; windowDays?: number };
        output: ActivityMonitorSummary;
      };
    };
    spendOverTime: {
      query: {
        input: {
          organizationId: string;
          windowDays?: number;
          groupBy?: SpendOverTimeGroupBy;
        };
        output: SpendOverTimeResult;
      };
    };
    spendByTeam: {
      query: {
        input: {
          organizationId: string;
          windowDays?: number;
          limit?: number;
          offset?: number;
          sortBy?: SpendSortField;
          sortDir?: GovernanceSortDirection;
        };
        output: SpendByTeamRow[];
      };
    };
    spendByUser: {
      query: {
        input: {
          organizationId: string;
          windowDays?: number;
          limit?: number;
          offset?: number;
          sortBy?: SpendSortField;
          sortDir?: GovernanceSortDirection;
        };
        output: SpendByUserRow[];
      };
    };
    spendByDepartment: {
      query: {
        input: { organizationId: string; windowDays?: number };
        output: SpendByDepartmentRow[];
      };
    };
    recentAnomalies: {
      query: {
        input: { organizationId: string; limit?: number };
        output: RecentAnomalyRow[];
      };
    };
    ingestionSourcesHealth: {
      query: {
        input: { organizationId: string };
        output: IngestionSourceHealthRow[];
      };
    };
    sourceHealthMetrics: {
      query: {
        input: { organizationId: string; sourceId: string };
        output: SourceHealthMetrics;
      };
    };
    eventsForSource: {
      query: {
        input: {
          organizationId: string;
          sourceId: string;
          limit?: number;
          beforeIso?: string;
        };
        output: ActivityEventDetailRow[];
      };
    };
  };

  aiTools: {
    adminList: {
      query: { input: { organizationId: string }; output: AiToolEntry[] };
    };
    /**
     * The reader's own catalogue. No hook here calls it; the write paths
     * invalidate it, and `useUtils()` can only name a procedure this map
     * declares.
     */
    list: {
      query: { input: { organizationId: string }; output: AiToolEntry[] };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          departmentIds?: string[];
          /**
           * Widened on purpose: the router builds its enum from
           * `AI_TOOL_TYPES` via a cast to `[string, ...string[]]`, so the
           * parsed field is a plain string, and `AiToolType` is assignable to it.
           */
          type: string;
          displayName: string;
          iconAsset?: string | null;
          order?: number;
          config: Record<string, unknown>;
        };
        output: AiToolEntry;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          displayName?: string;
          iconAsset?: string | null;
          /** Pass to overwrite the binding set; empty is org-wide. Omit to leave it. */
          departmentIds?: string[];
          order?: number;
          enabled?: boolean;
          type?: string;
          config?: Record<string, unknown>;
        };
        output: AiToolEntry;
      };
    };
    remove: {
      mutation: {
        input: { organizationId: string; id: string };
        output: AiToolEntry;
      };
    };
    reorder: {
      mutation: {
        input: {
          organizationId: string;
          updates: { id: string; order: number }[];
        };
        output: GovernanceAcknowledgement;
      };
    };
    setEnabled: {
      mutation: {
        input: { organizationId: string; id: string; enabled: boolean };
        output: AiToolEntry;
      };
    };
    importStarterPack: {
      mutation: {
        input: { organizationId: string; slugs?: string[] };
        output: GovernanceAiToolImportResult;
      };
    };
    starterPackCatalog: {
      query: {
        input: { organizationId: string };
        output: GovernanceAiToolStarterTile[];
      };
    };
    providerOptions: {
      query: {
        input: { organizationId: string };
        output: AiToolProviderOption[];
      };
    };
    routingPolicyOptions: {
      query: {
        input: { organizationId: string };
        output: GovernanceRoutingPolicyOption[];
      };
    };
  };

  anomalyRules: {
    list: {
      query: { input: { organizationId: string }; output: AnomalyRule[] };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          name: string;
          description?: string | null;
          severity: AnomalyRuleSeverity;
          ruleType: string;
          scope: AnomalyRuleScope;
          scopeId: string;
          thresholdConfig?: Record<string, unknown>;
          destinationConfig?: Record<string, unknown>;
          status?: AnomalyRuleStatus;
        };
        output: AnomalyRule;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          severity?: AnomalyRuleSeverity;
          ruleType?: string;
          scope?: AnomalyRuleScope;
          scopeId?: string;
          thresholdConfig?: Record<string, unknown>;
          destinationConfig?: Record<string, unknown>;
          status?: AnomalyRuleStatus;
        };
        output: AnomalyRule;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: AnomalyRule;
      };
    };
  };

  departments: {
    list: {
      query: { input: { organizationId: string }; output: GovernanceDepartmentView[] };
    };
    assignments: {
      query: {
        input: { organizationId: string };
        output: enterpriseGovernanceContractModule.DepartmentAssignments;
      };
    };
    create: {
      mutation: {
        input: { organizationId: string; name: string };
        output: Department;
      };
    };
    rename: {
      mutation: {
        input: { organizationId: string; id: string; name: string };
        output: Department;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GovernanceAcknowledgement;
      };
    };
    assignUser: {
      mutation: {
        input: { organizationId: string; userId: string; departmentId: string | null };
        output: GovernanceAcknowledgement;
      };
    };
  };

  governance: {
    quarantineFillStats: {
      query: {
        input: {
          organizationId: string;
          windowSeconds?: number;
          threshold?: number;
        };
        output: QuarantineFillStats;
      };
    };
    /**
     * Null covers every miss: the token names nobody, the person it names is
     * not in this organization, or they have no personal workspace yet. The
     * three stay indistinguishable so the answer never enumerates who exists.
     */
    resolveActorPersonalProject: {
      query: {
        input: { organizationId: string; actor: string };
        output: GovernanceActorWorkspace | null;
      };
    };
  };

  ingestionSources: {
    list: {
      query: {
        input: { organizationId: string };
        output: GovernanceIngestionSourceView[];
      };
    };
    get: {
      query: {
        input: { organizationId: string; id: string };
        output: GovernanceIngestionSourceView;
      };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          teamId?: string | null;
          sourceType: GovernanceIngestionSourceType;
          name: string;
          description?: string | null;
          parserConfig?: Record<string, unknown>;
          pullConfig?: Record<string, unknown> | null;
          pullSchedule?: string | null;
          traceProjectId?: string | null;
        };
        output: GovernanceIngestionSourceCreated;
      };
    };
    update: {
      mutation: {
        input: {
          organizationId: string;
          id: string;
          name?: string;
          description?: string | null;
          parserConfig?: Record<string, unknown>;
          status?: "active" | "disabled" | "awaiting_first_event";
          teamId?: string | null;
          pullSchedule?: string | null;
          traceProjectId?: string | null;
        };
        output: GovernanceIngestionSourceView;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GovernanceIngestionSourceView;
      };
    };
    rotateSecret: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GovernanceIngestionSourceCreated;
      };
    };
    ottlStarter: {
      query: {
        input: { organizationId: string; sourceType: string };
        output: GovernanceOttlStarter;
      };
    };
    validateOttl: {
      mutation: {
        input: { organizationId: string; statements: string[] };
        output: OttlValidationResult;
      };
    };
  };

  ingestionTemplates: {
    adminList: {
      query: { input: { organizationId: string }; output: IngestionTemplate[] };
    };
    get: {
      query: {
        input: { organizationId: string; id: string };
        output: IngestionTemplate;
      };
    };
    create: {
      mutation: {
        input: {
          organizationId: string;
          sourceType: string;
          displayName: string;
          description?: string;
          iconAsset?: string;
          credentialSchema?: "otlp_token" | "static_api_key" | "agent_id" | null;
          ottlRules?: string;
        };
        output: IngestionTemplate;
      };
    };
    archive: {
      mutation: {
        input: { organizationId: string; id: string };
        output: GovernanceAcknowledgement;
      };
    };
    cloneFromPlatform: {
      mutation: {
        input: { organizationId: string; sourceTemplateId: string };
        output: IngestionTemplate;
      };
    };
    updateOttlRules: {
      mutation: {
        input: { organizationId: string; id: string; ottlRules: string };
        output: IngestionTemplate;
      };
    };
  };

  routingPolicy: {
    list: {
      query: {
        input: {
          organizationId: string;
          selectableForScope?: {
            scopeType: RoutingPolicyScopeType;
            scopeId: string;
          };
        };
        output: RoutingPolicy[];
      };
    };
  };

  sessionPolicy: {
    get: {
      query: {
        input: { organizationId: string };
        output: GovernanceSessionPolicy;
      };
    };
    setMaxDuration: {
      mutation: {
        input: { organizationId: string; maxSessionDurationDays: number };
        output: GovernanceAcknowledgement;
      };
    };
  };

  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: GovernanceOrganizationGraph[];
      };
    };
  };

  limits: {
    getUsage: {
      query: {
        input: { organizationId: string };
        output: GovernanceUsageStats;
      };
    };
  };
};

// Governance tRPC hooks (shares cache with app proxy via createModuleApi).
export const governanceApi = createModuleApi<GovernanceApiMap>();

// RouterOutputs: same shape as screens use, so type aliases stay unchanged.
export type RouterOutputs = OutputsFromMap<GovernanceApiMap>;

/**
 * The name the screens call it by — they were written against the
 * application's `api` proxy and moved unchanged; the import line is what
 * tells them which one they have.
 */
export const api = governanceApi;
