/**
 * The stage that runs after the query, turning the keys the database answered
 * with into values: collect the distinct keys, check the caps before any fetch,
 * read once per kind, compute once per key, re-declare the column's type.
 * @see specs/lwql/app-functions.feature
 */

import {
  type LangWatchQLAppFunctionCall,
  type LangWatchQLCaller,
  type LangWatchQLColumn,
  type LangWatchQLExecuteInput,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  LWQL_HYDRATION_TRACE_IDS_PARAMETER,
} from "@langwatch/analytics-contract";

import {
  assembleLangWatchQLHydration,
  DEFAULT_LWQL_HYDRATION_LIMITS,
  type LangWatchQLHydrationLimits,
  type LangWatchQLHydrationResult,
} from "../rules/langwatch-ql-hydration-assembly.rules.ts";
import {
  assertLangWatchQLKeyCaps,
  collectLangWatchQLKeys,
  langWatchQLExtractionPlan,
} from "../rules/langwatch-ql-hydration-plan.rules.ts";
import { langWatchQLTraceRestrictedSql } from "../rules/langwatch-ql-hydration-sql.rules.ts";
import type { LangWatchQLHydrationComputeService } from "./langwatch-ql-hydration-compute.service.ts";
import {
  type LangWatchQLHydrationReadService,
  LWQL_NO_TRACES,
} from "./langwatch-ql-hydration-read.service.ts";

/** The execute path a text hydration reads its rows through. */
export interface LangWatchQLStatementRunner {
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

export class LangWatchQLHydrationService {
  private readonly reads: LangWatchQLHydrationReadService;
  private readonly compute: LangWatchQLHydrationComputeService;
  private readonly runner: LangWatchQLStatementRunner;
  private readonly limits: LangWatchQLHydrationLimits;

  private constructor(deps: {
    reads: LangWatchQLHydrationReadService;
    compute: LangWatchQLHydrationComputeService;
    runner: LangWatchQLStatementRunner;
    limits: LangWatchQLHydrationLimits;
  }) {
    this.reads = deps.reads;
    this.compute = deps.compute;
    this.runner = deps.runner;
    this.limits = deps.limits;
  }

  static create({
    reads,
    compute,
    runner,
    limits = DEFAULT_LWQL_HYDRATION_LIMITS,
  }: {
    reads: LangWatchQLHydrationReadService;
    compute: LangWatchQLHydrationComputeService;
    runner: LangWatchQLStatementRunner;
    limits?: LangWatchQLHydrationLimits;
  }): LangWatchQLHydrationService {
    return new LangWatchQLHydrationService({ reads, compute, runner, limits });
  }

  /**
   * Replaces every app-function key in a finished result with the value it
   * names. Returns the result unchanged, and reads nothing, when the statement
   * called no app function.
   */
  async hydrate({
    projectIds,
    protections,
    calls,
    columns,
    rows,
    signal,
  }: {
    projectIds: readonly string[];
    protections: LangWatchQLProtections;
    calls: readonly LangWatchQLAppFunctionCall[];
    columns: readonly LangWatchQLColumn[];
    rows: readonly Record<string, unknown>[];
    signal?: AbortSignal;
  }): Promise<LangWatchQLHydrationResult> {
    if (calls.length === 0) {
      return { columns, rows, isTruncatedByBytes: false, valueTruncations: [], unresolvedKeys: [] };
    }

    const resolved = collectLangWatchQLKeys({ calls, rows });
    assertLangWatchQLKeyCaps(resolved);

    const traces =
      resolved.length === 0
        ? LWQL_NO_TRACES
        : await this.reads.readTraces({
            projectIds,
            protections,
            resolved,
            maxReadBytes: this.limits.maxReadBytes,
            ...(signal ? { signal } : {}),
          });
    const computed = await this.compute.computeValues({
      resolved,
      traces,
      maxHydratedValueBytes: this.limits.maxHydratedValueBytes,
    });

    return assembleLangWatchQLHydration({
      columns,
      rows,
      resolved,
      computed,
      limits: this.limits,
    });
  }

  /**
   * One page with the judged columns holding the text that would be judged
   * rather than a verdict. No classifier is called and nothing is charged:
   * reading what a run judges must not cost what judging it costs.
   */
  async hydrateTexts({
    project,
    protections,
    sql,
    parameters,
    calls,
    traceIds,
  }: {
    project: LangWatchQLCaller;
    protections: LangWatchQLProtections;
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
    calls: readonly LangWatchQLAppFunctionCall[];
    traceIds: readonly string[];
  }): Promise<readonly Record<string, unknown>[]> {
    if (traceIds.length === 0) return [];
    const execution = await this.runner.executeLangWatchQL({
      project,
      protections,
      sql: langWatchQLTraceRestrictedSql(sql),
      parameters: { ...parameters, [LWQL_HYDRATION_TRACE_IDS_PARAMETER]: [...traceIds] },
    });
    const hydrated = await this.hydrate({
      projectIds: [project.id],
      protections,
      calls: langWatchQLExtractionPlan(calls),
      columns: execution.columns,
      rows: execution.rows,
    });

    return hydrated.rows;
  }
}
