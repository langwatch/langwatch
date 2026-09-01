/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts` and
 * `governance-api.ts` say of their own maps: the procedures live in
 * `@langwatch/user-server`, `@langwatch/organization-server`,
 * `@langwatch/project-server`, `@langwatch/coding-agent-server` and
 * `@langwatch/enterprise-governance-server`, none of which a web package may
 * import even for a type, and the router type does not exist until a process
 * instantiates it. Emitting this file from the mounted router is the fix;
 * writing it by hand is the interim, and it is honest only because the payload
 * types below are the contract's wherever the contract has them.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `user`, `personalVirtualKeys`,
 * `personalSessions` and the rest are mount points on the root router, and tRPC
 * hashes that path into the React Query cache key; spell one differently and
 * these hooks quietly stop sharing a cache with the `api.user.*` call sites
 * that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. It buys a content-faithful move:
 * every `api.x.y.useQuery(...)` call site in the seven screens is the line it
 * was in `platform/app`. Recorded here so the finding it raises is a decision
 * rather than a surprise.
 *
 * DATE, STRING OR NUMBER IS NOT A CHOICE THIS FILE MAKES. The routers behind
 * these procedures disagree about how an instant reaches the browser, and the
 * disagreement is what the screens already render against: the personal
 * verticals project through DTOs that hand over EPOCH MILLISECONDS
 * (`createdAtMs`, `lastSeenMs`); the budget overview calls `.toISOString()`, so
 * `resetsAt` is a STRING; and `organization.getAll` answers with the stored
 * Prisma rows over superjson, so everything on it is a DATE. Every entry below
 * states which, because getting it wrong typechecks here and fails at the call
 * site.
 *
 * ADD A PROCEDURE when a hook in this package needs one. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type { CodingAgentUsageTotals } from "@langwatch/coding-agent-contract";
import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";

/** An acknowledgement, for the writes whose only answer is that they happened. */
export type PersonalAcknowledgement = { ok: boolean };

/**
 * The workspace a person is given inside an organization.
 *
 * `EnsuredPersonalWorkspace` in `@langwatch/organization-contract`, written out
 * here rather than imported: three fields, against a dependency this package
 * would otherwise not have. Both `createdAtMs` fields are EPOCH MILLISECONDS.
 */
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

/** What a person spent, over the window the dashboard asks about. */
export type PersonalUsageRollup = {
  summary: {
    spentUsd: number;
    billedUsd: number;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    mostUsedModel: { name: string; usagePct: number } | null;
  };
  /** `day` is a calendar day, `"YYYY-MM-DD"`, not an instant. */
  dailyBuckets: Array<{
    day: string;
    spentUsd: number;
    billedUsd: number;
    requests: number;
  }>;
  breakdownByModel: Array<{
    label: string;
    spentUsd: number;
    billedUsd: number;
    requests: number;
  }>;
};

/**
 * The budget that binds this person, as the banners read it.
 *
 * A union, and the narrow arm is a real answer: an organization with no
 * applicable budget collapses to `{ status: "ok" }` with none of the figures.
 * The amounts are DECIMAL STRINGS, because the ledger's are.
 */
export type PersonalBudgetState =
  | { status: "ok" }
  | {
      status: "ok" | "warning" | "exceeded";
      scope: string;
      spentUsd: string;
      limitUsd: string;
      period: string;
      requestIncreaseUrl?: string | undefined;
      adminEmail: string | null;
    };

/** One budget that applies to this person, most binding first. */
export type PersonalBudgetOverviewItem = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  scopeLabel: string;
  window: string;
  /** Decimal strings, both. */
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  timezone: string | null;
  providerKey: string | null;
  providerLabel: string | null;
  isPerMember: boolean;
  managedByVirtualKeyId: string | null;
  scopeClass: "organization" | "team" | "project" | "personal" | "key" | "department" | "other";
  scopePhrase: string;
  /** An ISO STRING, or null on a window that never resets. */
  resetsAt: string | null;
  /** Only attached for a personal budget, and only when asked for. */
  topModels?: Array<{ model: string; spentUsd: number }>;
};

export type PersonalBudgetOverviewPayload = {
  gatewayAccess: boolean;
  reason?: "flag_off" | "no_membership";
  budgets: PersonalBudgetOverviewItem[];
};

/**
 * A personal virtual key as this vertical hands it over.
 *
 * DELIBERATELY NOT the gateway's `VirtualKeyView`: that one stringifies every
 * instant and carries a dozen more columns. This one is EPOCH MILLISECONDS and
 * eleven fields, and a consumer holding both would have two meanings for one
 * word.
 */
export type PersonalVirtualKeyView = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  displayPrefix: string;
  status: string;
  principalUserId: string | null;
  routingPolicyId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  lastUsedAtMs: number | null;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
};

/** A key together with its secret, which the mutation that mints one returns once. */
export type PersonalVirtualKeyMinted = {
  id: string;
  label: string;
  secret: string;
  baseUrl: string;
  displayPrefix: string;
  routingPolicyId: string | null;
};

/** One device the CLI is signed in on. Every instant is EPOCH MILLISECONDS. */
export type PersonalCliSession = {
  sessionStartedAtMs: number;
  deviceLabel: string;
  hostname: string | null;
  uname: string | null;
  platform: string | null;
  lastSeenMs: number;
  expiresAtMs: number;
};

/** Which of the optional workspace features are turned on. */
export type PersonalWorkspaceFeatures = {
  evaluations: boolean;
  datasets: boolean;
  annotations: boolean;
  automations: boolean;
};

/** An ingestion template a person can install a key for. */
export type IngestionTemplateView = {
  id: string;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  /** Always empty on this read: the rules are the administrator's business. */
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
  /** Null on a platform-published row. */
  organizationId: string | null;
};

/** An ingestion key this person already holds. */
export type PersonalIngestionKeyView = {
  apiKeyId: string;
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
};

/** A freshly minted ingestion key, secret and all, returned exactly once. */
export type IssuedIngestionKeyView = {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
};

/** Where this person should land, and why. */
export type PersonaResolutionView = {
  persona: "personal_only" | "mixed" | "project_only" | "governance_admin";
  destination: string;
  isOverride: boolean;
  governanceUiEnabled: boolean;
  intentPinned: boolean;
};

/**
 * The organization graph, narrowed to what this family reads.
 *
 * The procedure answers with the stored Prisma rows — every organization
 * column, every team column, every project column, and every instant as a real
 * `Date` over superjson. Four of those fields are what the personal workspace
 * asks about, plus the caller's own membership row, which is what tells a
 * view-only member why their workspace refuses writes. Declaring the rest would
 * be declaring columns nothing here renders.
 */
export type PersonalOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  /**
   * Narrowed to the caller's own row by the read itself. On a demo
   * organization the demo user's row can appear beside it, so this is a list
   * rather than one row.
   */
  members: Array<{ userId: string; role: string }>;
  teams: Array<{
    id: string;
    name: string;
    projects: Array<{ id: string; name: string; slug: string }>;
  }>;
};

export type PersonalWorkspaceApiMap = {
  user: {
    personalContext: {
      query: { input: { organizationId: string }; output: PersonalWorkspaceContext };
    };
    personalUsage: {
      query: {
        input: { organizationId: string; windowStartMs?: number; windowEndMs?: number };
        output: PersonalUsageRollup;
      };
    };
    personalBudget: {
      query: { input: { organizationId: string }; output: PersonalBudgetState };
    };
    budgetOverview: {
      query: {
        input: { organizationId: string; includeTopModels?: boolean };
        output: PersonalBudgetOverviewPayload;
      };
    };
    requestBudgetIncrease: {
      mutation: {
        input: {
          organizationId: string;
          scope: string;
          scopeId: string;
          limitUsd: string;
          spentUsd: string;
          period?: string | undefined;
          message?: string | undefined;
        };
        output: { ok: boolean; sentTo: string };
      };
    };
    setAvatar: {
      mutation: {
        input: { organizationId: string; imageDataUrl: string };
        output: { image: string };
      };
    };
    removeAvatar: {
      mutation: { input: Record<string, never>; output: { success: boolean } };
    };
    homePagePickerState: {
      query: {
        input: { organizationId: string };
        output: { lastHomePath: string | null; firstProjectSlug: string | null };
      };
    };
    setLastHomePath: {
      mutation: { input: { path: string | null }; output: { ok: boolean } };
    };
  };

  personalVirtualKeys: {
    list: {
      query: {
        input: { organizationId: string; targetUserId?: string };
        output: PersonalVirtualKeyView[];
      };
    };
    issuePersonal: {
      mutation: {
        input: { organizationId: string; label: string; routingPolicyId?: string };
        output: PersonalVirtualKeyMinted;
      };
    };
    revokePersonal: {
      mutation: {
        input: { organizationId: string; id: string };
        output: PersonalAcknowledgement;
      };
    };
  };

  personalSessions: {
    list: {
      query: { input: { organizationId: string }; output: PersonalCliSession[] };
    };
    revoke: {
      mutation: {
        input: { organizationId: string; sessionStartedAtMs: number };
        output: { ok: boolean; revokedTokens: number };
      };
    };
    revokeAll: {
      mutation: {
        input: { organizationId: string };
        output: { ok: boolean; revokedTokens: number };
      };
    };
  };

  personalWorkspaceFeatures: {
    get: {
      query: { input: { projectId: string }; output: PersonalWorkspaceFeatures };
    };
    enableAll: {
      mutation: { input: { projectId: string }; output: PersonalWorkspaceFeatures };
    };
    disableAll: {
      mutation: { input: { projectId: string }; output: PersonalWorkspaceFeatures };
    };
  };

  aiTools: {
    list: {
      query: { input: { organizationId: string }; output: AiToolEntry[] };
    };
    providerAvailability: {
      query: {
        input: { organizationId: string };
        output: { configuredProviders: string[] };
      };
    };
  };

  ingestionTemplates: {
    list: {
      query: { input: { organizationId: string }; output: IngestionTemplateView[] };
    };
  };

  ingestionKey: {
    list: {
      query: { input: { organizationId: string }; output: PersonalIngestionKeyView[] };
    };
    install: {
      mutation: {
        input: { organizationId: string; sourceType: string; templateId?: string };
        output: IssuedIngestionKeyView;
      };
    };
    rotate: {
      mutation: {
        input: { organizationId: string; sourceType: string; templateId?: string };
        output: IssuedIngestionKeyView;
      };
    };
  };

  governance: {
    resolveHome: {
      query: { input: { organizationId: string }; output: PersonaResolutionView };
    };
  };

  codingAgents: {
    usageTotals: {
      query: {
        input: { projectId: string; fromMs?: number; toMs?: number };
        output: CodingAgentUsageTotals;
      };
    };
  };

  project: {
    getHasFirstMessage: {
      query: { input: { projectId: string }; output: { firstMessage: boolean } };
    };
  };

  organization: {
    /**
     * The organization graph the scope is resolved out of.
     *
     * Read by the frontend feature that mounts these screens rather than by a
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per
     * document however many halves of the product want it.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: PersonalOrganizationGraph[];
      };
    };
  };
};

/**
 * The personal workspace's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other
 * packages call the hooks. It is exported from `screens/personal-workspace`
 * only so the process shell can mount `personalWorkspaceApi.Provider`.
 */
export const personalWorkspaceApi = createFeatureApi<PersonalWorkspaceApiMap>();

/**
 * The name the screens call it by.
 *
 * They were written against the application's `api` proxy and are moved
 * unchanged; the import line is what tells them which one they have.
 */
export const api = personalWorkspaceApi;
