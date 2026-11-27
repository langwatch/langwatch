// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SecurityLakeCallers } from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type {
  SecurityLakeCallerRepository,
  SecurityLakeCallerRow,
} from "../../../repositories/security-lake-caller.repository.ts";
import { awsPrincipalKey, awsPrincipalMatch } from "../rules/aws-principal.rules.ts";

/** The trace attribute an agent sets to its AWS principal ARN. */
export const TRACE_AWS_PRINCIPAL_ATTRIBUTE = "aws.principal.arn";
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CALLER_LIMIT = 500;
/** Trace lookups in flight at once, so an organisation with many projects does not flood ClickHouse. */
export const TRACE_LOOKUP_CONCURRENCY = 4;

export interface SecurityLakeCallersDeps {
  events: SecurityLakeCallerRepository;
  traces: Pick<TraceApi, "countAttributedTracesByValue">;
  projects: Pick<ProjectApi, "findInternal" | "findLiveNonGovernanceIdsByOrganization">;
}

/** Model callers seen in Security Lake that send no traces to LangWatch. */
export class SecurityLakeCallersService {
  private constructor(private readonly deps: SecurityLakeCallersDeps) {}

  static create(deps: SecurityLakeCallersDeps): SecurityLakeCallersService {
    return new SecurityLakeCallersService(deps);
  }

  /**
   * Security Lake rows grouped by account and role, minus the roles that a trace in any of the
   * organisation's projects names in `aws.principal.arn` (any session or the IAM form) over 30 days.
   * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
   */
  async withoutTraces(input: { organizationId: string }): Promise<SecurityLakeCallers> {
    const govProject = await this.deps.projects.findInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    if (!govProject) return { callers: [] };
    const sinceMs = nowInstant().epochMilliseconds - WINDOW_MS;
    const callers = await this.deps.events.findSecurityLakeCallers({
      tenantId: govProject.id,
      sinceMs,
      limit: CALLER_LIMIT,
    });
    if (callers.length === 0) return { callers: [] };
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId: input.organizationId,
    });
    const grouped = groupByRole(callers);
    const values = new Set<string>();
    const valuePrefixes = new Set<string>();
    for (const caller of callers) {
      const match = awsPrincipalMatch(caller.principalArn);
      for (const value of match.values) values.add(value);
      for (const prefix of match.prefixes) valuePrefixes.add(prefix);
    }
    const traced = new Set<string>();
    await forEachWithConcurrency({
      items: projectIds,
      concurrency: TRACE_LOOKUP_CONCURRENCY,
      // Once every role is traced no other project can change the answer.
      done: () => traced.size >= grouped.size,
      run: async (projectId) => {
        const counts = await this.deps.traces.countAttributedTracesByValue({
          projectId,
          matches: [],
          valueKey: TRACE_AWS_PRINCIPAL_ATTRIBUTE,
          values: [...values],
          valuePrefixes: [...valuePrefixes],
          sinceMs,
        });
        for (const row of counts) {
          const key = awsPrincipalKey(row.value);
          // The account-wide prefix also returns unrelated roles; only callers count towards done.
          if (row.count > 0 && grouped.has(key)) traced.add(key);
        }
      },
    });
    return { callers: [...grouped].filter(([key]) => !traced.has(key)).map(([, row]) => row) };
  }
}

/** Runs `run` over `items` with at most `concurrency` calls in flight, stopping early once `done`. */
async function forEachWithConcurrency<T>({
  items,
  concurrency,
  done,
  run,
}: {
  items: readonly T[];
  concurrency: number;
  done: () => boolean;
  run: (item: T) => Promise<void>;
}): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length && !done()) {
      const item = items[next] as T;
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}

/** Folds the sessions of one role into one caller, keyed by account and role name. */
function groupByRole(
  callers: readonly SecurityLakeCallerRow[],
): Map<string, SecurityLakeCallerRow> {
  const grouped = new Map<string, SecurityLakeCallerRow>();
  for (const caller of callers) {
    const key = awsPrincipalKey(caller.principalArn);
    const seen = grouped.get(key);
    grouped.set(
      key,
      seen
        ? {
            principalArn: seen.principalArn,
            models: [...new Set([...seen.models, ...caller.models])],
            regions: [...new Set([...seen.regions, ...caller.regions])],
            lastCallMs: Math.max(seen.lastCallMs, caller.lastCallMs),
            callCount: seen.callCount + caller.callCount,
          }
        : caller,
    );
  }
  return grouped;
}
