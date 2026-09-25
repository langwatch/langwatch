/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load-bearing for React Query cache.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { CodingAgentUsageTotals } from "@langwatch/coding-agent-contract";
import type { personalVirtualKeysTrpc } from "@langwatch/enterprise-gateway-contract";
import type { identityTrpc } from "@langwatch/identity-contract";
import type { userTrpc } from "@langwatch/user-contract";

import type { AiToolEntry } from "../model/ai-tool-catalog.ts";

/**
 * The workspace a person is given inside an organization. `EnsuredPersonalWorkspace` in
 * `@langwatch/organization-contract`, written out here rather than imported: three fields,
 * against a dependency this package would otherwise not have.
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

/**
 * The budget that binds this person, as the banners read it. A union, and the narrow arm is a
 * real answer: an organization with no applicable budget collapses to `{ status: "ok" }` with
 * none of the figures. The amounts are DECIMAL STRINGS, because the ledger's are.
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
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
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
  firstProjectSlug: string | null;
};

/**
 * The organization graph, narrowed to what this family reads. The procedure answers with the
 * stored Prisma rows, every instant as an ISO 8601 string.
 */
export type PersonalOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  members: { userId: string; role: string }[];
  ssoProvider?: string | null;
  teams: {
    id: string;
    name: string;
    projects: { id: string; name: string; slug: string }[];
  }[];
};

/** One of THIS reader's own keys, the fields the profile summary shows. */
export type PersonalApiKeyListEntry = {
  id: string;
  name: string;
  permissionMode: string;
  userId: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type BorrowedProcedures = {
  license: {
    getSsoGateStatus: {
      query: {
        input: Record<string, never>;
        output: { configuredProvider: string | null; licensed: boolean; mounted: boolean };
      };
    };
  };
  limits: {
    getUsage: {
      query: {
        input: { organizationId: string };
        output: { activePlan: { type: string } };
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
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: PersonalOrganizationGraph[];
      };
    };
  };
  apiKey: {
    list: {
      query: {
        input: { organizationId: string };
        output: PersonalApiKeyListEntry[];
      };
    };
  };
};

export type PersonalWorkspaceApiMap = ContractApiMap<typeof userTrpc> &
  ContractApiMap<typeof identityTrpc> &
  ContractApiMap<typeof personalVirtualKeysTrpc> &
  BorrowedProcedures;

/**
 * The personal workspace's typed tRPC hooks. Same machinery, same transport and same React
 * Query cache as the application's `api` proxy.
 */
export const personalWorkspaceApi = createModuleApi<PersonalWorkspaceApiMap>();

/** The name the screens call it by. */
export const api = personalWorkspaceApi;
