/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 */

import type { TimeInput } from "@langwatch/time";
import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type {
  opsDashboardTrpc,
  opsEventLogTrpc,
  opsPlatformTrpc,
  opsProcessTrpc,
  opsQueueTrpc,
} from "@langwatch/ops-contract";
import type { promptTrpc } from "@langwatch/prompt-contract";

/** One organization, as the Foundry's project picker reads the graph. */
export type OpsOrganizationGraph = {
  id: string;
  name: string;
  slug: string;
  teams: {
    id: string;
    name: string;
    slug: string;
    projects: { id: string; name: string; slug: string; apiKey: string }[];
  }[];
};

/**
 * Procedures other features own. Organization belongs to a separate feature,
 * not yet split. SSO connections are enterprise-only, imported through composition.
 */
/** One report in the issue inbox's listing. */
export type BugReportListingRow = {
  id: string;
  createdAt: TimeInput;
  source: string;
  kind: string;
  title: string;
  agent: string | null;
  linkedProjectId: string | null;
  contactEmail: string | null;
};

/** One report opened in full, transcript included. */
export type BugReportDetail = BugReportListingRow & {
  summary: string | null;
  cliVersion: string | null;
  sessionData: string | null;
  sessionTruncated: boolean;
};

/**
 * One SSO connection as the back office reads it.
 */
export type BackofficeSsoConnection = Readonly<{
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  type: string;
  state: string;
  claimedDomains: string[];
  approvedDomains: string[];
  verifiedDomains: string[];
  domainVerifications: {
    domain: string;
    method: string;
    actorId: string | null;
    verifiedAtMs: number;
  }[];
  providerId: string;
  issuer: string | null;
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

type BorrowedProcedures = {
  organization: {
    /**
     * Foundry's project picker reads this, but organization belongs to
     * a separate feature, not in this contract.
     */
    getAll: { query: { input: { isDemo: boolean }; output: OpsOrganizationGraph[] } };
  };
  bugReports: {
    getAll: {
      query: {
        input: { page: number; pageSize: number; search?: string };
        output: { reports: BugReportListingRow[]; total: number };
      };
    };
    getById: { query: { input: { id: string }; output: BugReportDetail } };
  };
  ssoConnections: {
    getAll: {
      query: {
        input: { page: number; pageSize: number; search?: string };
        output: { connections: BackofficeSsoConnection[]; total: number };
      };
    };
    getById: {
      query: { input: { connectionId: string }; output: BackofficeSsoConnection | null };
    };
    approveDomainClaim: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string };
        output: undefined;
      };
    };
    rejectDomainClaim: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string; note: string };
        output: undefined;
      };
    };
    attestDomain: {
      mutation: {
        input: { organizationId: string; connectionId: string; domain: string };
        output: undefined;
      };
    };
    activate: {
      mutation: {
        input: { organizationId: string; connectionId: string; testLoginAccountId: string };
        output: undefined;
      };
    };
    suspend: {
      mutation: {
        input: { organizationId: string; connectionId: string; reason: string | null };
        output: undefined;
      };
    };
    resume: {
      mutation: { input: { organizationId: string; connectionId: string }; output: undefined };
    };
    requestTeardown: {
      mutation: {
        input: { organizationId: string; connectionId: string; reason: string | null };
        output: undefined;
      };
    };
  };
};

/**
 * The whole `ops.*`, `bugReports.*`, `prompts.*`, `ssoConnections.*` and
 * `organization.*` surface this package calls.
 */
export type OpsApiMap = ContractApiMap<typeof opsDashboardTrpc> &
  ContractApiMap<typeof opsEventLogTrpc> &
  ContractApiMap<typeof opsPlatformTrpc> &
  ContractApiMap<typeof opsProcessTrpc> &
  ContractApiMap<typeof opsQueueTrpc> &
  ContractApiMap<typeof promptTrpc> &
  BorrowedProcedures;

/**
 * The hooks every Ops screen calls. One instance for the package.
 */
export const opsApi = createModuleApi<OpsApiMap>();

/**
 * Every procedure's output, addressed the way the screens already address it. The application's
 * `~/utils/api` exported `RouterOutputs` off the real `AppRouter`; deriving the same shape from
 * the map above keeps those aliases exactly as they were written.
 */
export type RouterOutputs = OutputsFromMap<OpsApiMap>;

/**
 * The name the screens call it by. They were written against the application's `api` proxy and
 * are moved unchanged; the import line is what tells them which one they have.
 */
export const api = opsApi;
