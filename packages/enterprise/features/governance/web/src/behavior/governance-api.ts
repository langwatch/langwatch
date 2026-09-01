/**
 * The governance procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `trace-api.ts` says
 * of its own map: the procedures live in `@langwatch/enterprise-governance-server`,
 * which a web package may not import even for a type, and the router type does
 * not exist until a process instantiates it. Emitting this file from the mounted
 * router is the fix; writing it by hand is the interim, and it is honest only
 * because the payload types below are the contract's — the same ones the
 * procedure parses and returns.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `aiTools`, `ingestionSources` and the
 * rest are mount points on the root router, and tRPC hashes that path into the
 * React Query cache key; spell one differently and these hooks quietly stop
 * sharing a cache with the `api.aiTools.*` call sites that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. It buys a content-faithful move:
 * every `api.x.y.useQuery(...)` call site in the eleven screens is the line it
 * was in `platform/app`. Replacing it means a port per procedure and a rewrite
 * of eight thousand lines, which is a different change from a move. Recorded
 * here so the finding it raises is a decision rather than a surprise.
 *
 * ADD A PROCEDURE when a hook in this package needs one. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  ActivityEventDetailRow,
  ActivityMonitorSummary,
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

/**
 * An acknowledgement, for the writes whose only answer is that they happened.
 *
 * `departments.archive`, `aiTools.reorder` and `sessionPolicy.setMaxDuration`
 * return `{ ok: true }` after awaiting a void service call;
 * `ingestionTemplates.archive` returns `{ ok: true as const }` and so types the
 * field as the literal. One name covers all four because `.ok` is the only
 * thing anything reads, and the literal is assignable to the boolean.
 */
export type GovernanceAcknowledgement = { ok: boolean };

/**
 * An IngestionSource as the wire carries it, which is not the row the server
 * holds.
 *
 * `toIngestionSourceDto` drops `ingestSecretHash`, `errorCount` and the raw
 * `pollerCursor`, strips every underscore-prefixed slot and the sealed
 * `credentials` envelope out of `parserConfig`, and adds two fields the column
 * set has no equivalent for: `hasPollerCursor`, the predicate the edit form
 * asks before offering a backfill start, and `traceProjectArchived`, which is
 * true when the destination this source points at is no longer live in the
 * organization.
 *
 * DELIBERATELY NOT NAMED `GovernanceIngestionSource`. The contract already
 * exports that name for the server-side row, and a consumer holding both would
 * have two different shapes under one word.
 */
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
  lastEventAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
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

/**
 * The canonical OTTL starter set for a source type, plus whether the editor is
 * offered for it at all.
 *
 * `enabledSourceTypes` is typed `string[]` rather than the contract's
 * `OttlEnabledSourceType[]`. The wire value is a spread of a `readonly` tuple,
 * so the narrow type is true, but a union-typed array refuses
 * `.includes(someString)` — which is the one thing a caller holding a source
 * type wants to do with it.
 */
export type GovernanceOttlStarter = {
  enabled: boolean;
  statements: string[];
  enabledSourceTypes: string[];
};

/**
 * Where an actor's own workspace lives, for the admin drill-in link on the
 * bird's-eye user page.
 *
 * Declared here rather than imported because it belongs to
 * `@langwatch/enterprise-governance-server`, which a web package may not name.
 * `displayName` is never blank: the resolver falls back through name, email and
 * id so the admin reading the link always gets a person.
 */
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
 * The plan an organization's usage is measured against.
 *
 * Restated here rather than imported: it belongs to
 * `@langwatch/entitlement-contract`, which is neither the platform API client
 * nor this feature's contract, and `limits` is the one procedure in this map
 * whose payload no governance type describes.
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
 * The limit reading with its copy already written. The sentence is composed on
 * the server because the same number appears in the sidebar, on the settings
 * page and in the approaching-limit email, and three renderings of one number
 * is how they start disagreeing.
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

/**
 * The governance procedures this package calls, nested exactly as the process's
 * root router mounts them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED. The procedures live across four
 * server packages a web package may not import — `@langwatch/enterprise-
 * governance-server` for eight of these ten families, the same package for
 * `routingPolicy` despite the gateway composition mounting it, and
 * `@langwatch/entitlement-server` for `limits`. ADR-101 forbids the dependency,
 * and `oxlint-plugin.mjs` rejects the `@trpc/server` import such a type would
 * need without exempting `import type`. Even with the lint relaxed there is
 * nothing to import: every `*TrpcApi.create` is generic over the process's
 * context and root, so the router type does not exist until `apps/api`
 * instantiates it. Emitting this file from the mounted router is the fix;
 * writing it by hand is the interim, and it is honest only to the extent that
 * the payload types below are the contract's — the same ones the procedures
 * parse and return.
 *
 * The segment names are load-bearing. Each leading segment is a mount point on
 * the root router, and tRPC hashes that path into the React Query cache key;
 * spell one differently and these hooks quietly stop sharing a cache with the
 * `api.activityMonitor.*` call sites that have not moved yet. `governance` in
 * particular is a merge of the application's own router with the enterprise
 * one, so the two procedures named here sit beside procedures this map does not
 * describe.
 *
 * INPUTS ARE `z.input`, not the parsed shape. A field carrying `.default()` or
 * `.optional()` in the router's schema is optional here, which is why
 * `windowDays`, every pagination knob, and both quarantine thresholds are
 * written with a `?` even though the resolver always sees a value.
 *
 * DATES SURVIVE. The transport is superjson, so a `Date` the server returns
 * arrives as a `Date` rather than an ISO string. The many `*Iso` fields are the
 * opposite case: those are strings on the server too, named for what they hold.
 *
 * ADD A PROCEDURE when a hook in this package needs it. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */
/**
 * The organization graph, as the governance section reads it.
 *
 * `organization.getAll` hands back fully loaded rows with dozens of columns;
 * this names the seven fields the section uses — the organization it is scoped
 * to, the teams a page lists, and the projects a trace destination is picked
 * from. It is a view of the wire, not the whole of it, and it is deliberately
 * the same procedure and the same input the application shell already asks
 * with, so the two share one cache entry and one request.
 */
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
           * Widened on purpose. The router builds its enum from
           * `AI_TOOL_TYPES` through a cast to `[string, ...string[]]`, so the
           * parsed field is a plain string; `AiToolType` is assignable to it,
           * and a variable already typed `string` is too.
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
          updates: Array<{ id: string; order: number }>;
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
      query: { input: { organizationId: string }; output: Department[] };
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

/**
 * Governance's typed tRPC hooks. Same machinery, same transport and same React
 * Query cache as the application's `api` proxy — see `createFeatureApi` for why
 * separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other
 * packages call the hooks. It is exported from `src/index.ts` only so the
 * process shell can mount `governanceApi.Provider`.
 */
export const governanceApi = createFeatureApi<GovernanceApiMap>();

/**
 * Every procedure's output, addressed the way the screens already address it.
 *
 * The application's `~/utils/api` exported `RouterOutputs` off the real
 * `AppRouter`, and the screens wrote `RouterOutputs["ingestionSources"]["list"][number]`.
 * Deriving the same shape from the map above keeps those type aliases exactly
 * as they were written, and keeps them honest: an output that changes here
 * changes at every alias, which is what a generated map will do too.
 */
type GovernanceOutputOf<TNode> = TNode extends { query: { output: infer TOutput } }
  ? TOutput
  : TNode extends { mutation: { output: infer TOutput } }
    ? TOutput
    : { [TSegment in keyof TNode]: GovernanceOutputOf<TNode[TSegment]> };

export type RouterOutputs = {
  [TSegment in keyof GovernanceApiMap]: GovernanceOutputOf<GovernanceApiMap[TSegment]>;
};

/**
 * The name the screens call it by.
 *
 * They were written against the application's `api` proxy and are moved
 * unchanged; the import line is what tells them which one they have.
 */
export const api = governanceApi;
