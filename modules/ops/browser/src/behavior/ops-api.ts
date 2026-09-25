/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 */

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type { ssoConnectionTrpc } from "@langwatch/enterprise-sso-contract";
import type { identityLookupTrpc } from "@langwatch/identity-contract";
import type {
  licenseRegistryTrpc,
  opsDashboardTrpc,
  opsEventLogTrpc,
  opsPlatformTrpc,
  opsProcessTrpc,
  opsQueueTrpc,
  selfHostedInstancesTrpc,
} from "@langwatch/ops-contract";
import type { promptTrpc } from "@langwatch/prompt-contract";
import type { TimeInput } from "@langwatch/time";

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

/** Procedures whose owners declare no contract yet: organization and bug reports. */
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
};

/**
 * The whole `ops.*`, `bugReports.*`, `prompts.*`, `ssoConnections.*`,
 * `identityLookup.*` and `organization.*` surface this package calls.
 */
export type OpsApiMap = ContractApiMap<typeof opsDashboardTrpc> &
  ContractApiMap<typeof opsEventLogTrpc> &
  ContractApiMap<typeof opsPlatformTrpc> &
  ContractApiMap<typeof opsProcessTrpc> &
  ContractApiMap<typeof opsQueueTrpc> &
  ContractApiMap<typeof licenseRegistryTrpc> &
  ContractApiMap<typeof selfHostedInstancesTrpc> &
  ContractApiMap<typeof promptTrpc> &
  ContractApiMap<typeof ssoConnectionTrpc> &
  ContractApiMap<typeof identityLookupTrpc> &
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
