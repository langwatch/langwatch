// Hand-written governance procedures (meant to be generated).
// Segment names load-bearing (mount points, cache keys); only ADR-004 exception.

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type {
  activityMonitorTrpc,
  aiToolsTrpc,
  governanceAgentsTrpc,
  governanceCostTrpc,
  governancePeopleTrpc,
  sessionPolicyTrpc,
  AnomalyRule,
  AnomalyRuleScope,
  AnomalyRuleSeverity,
  AnomalyRuleStatus,
  Department,
  GovernanceIngestionSourceType,
  IngestionTemplate,
  OttlValidationResult,
  QuarantineFillStats,
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

/** The organization's session-lifetime policy. Zero days means unbounded. */

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

export type GovernanceApiMap = ContractApiMap<typeof activityMonitorTrpc> &
  ContractApiMap<typeof sessionPolicyTrpc> &
  ContractApiMap<typeof governancePeopleTrpc> &
  ContractApiMap<typeof governanceAgentsTrpc> &
  ContractApiMap<typeof aiToolsTrpc> &
  ContractApiMap<typeof governanceCostTrpc> & {
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
