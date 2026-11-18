import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { LangyApi } from "@langwatch/langy-contract";
import { LogApi } from "@langwatch/log-contract";
import type { BoundApis } from "@langwatch/process";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { SuiteApi } from "@langwatch/suite-contract";
import { TraceApi } from "@langwatch/trace-contract";

const STORED_BYTES_OWNERS = {
  traces: TraceApi,
  logs: LogApi,
  evaluations: EvaluationApi,
  experiments: ExperimentApi,
  scenarios: ScenarioApi,
  suites: SuiteApi,
  langy: LangyApi,
} as const;

/** One owning module's answer to the storage meter: its stored bytes for one project. */
export type StoredBytesOwner = Readonly<{
  getStoredBytes(input: { projectId: string; beforeMs?: number }): Promise<number>;
}>;

/** Each module owning metered tables, by name, asked for its own bytes (ADR-202 Decided 20). */
export type StoredBytesOwners = Readonly<
  Record<keyof typeof STORED_BYTES_OWNERS, StoredBytesOwner>
>;

/** One owning module's count of a project's stored items a shorter period would remove. */
export type StoredPastRetentionOwner = Readonly<{
  countStoredPastRetention(input: {
    projectId: string;
    beforeMs: number;
    retentionDays: number;
  }): Promise<number>;
}>;

/** The module storing each category's items, asked for its own count (ADR-202 Decided 20). */
export type StoredPastRetentionOwners = Readonly<
  Record<RetentionCategory, StoredPastRetentionOwner>
>;

/** Every channel data-retention holds, as the container hands them to the module class. */
export interface DataRetentionChannels {
  readonly storedBytesOwners: StoredBytesOwners;
  readonly storedPastRetentionOwners: StoredPastRetentionOwners;
}

/**
 * Both tiers bind the owners: a binding is to a module, not a store, and is no peer (Alex,
 * 2026-10-08, round 34; record §5), so every owner may keep depending on data-retention.
 */
export class BoundDataRetentionChannels {
  static readonly requires = [] as const;
  static readonly binds = STORED_BYTES_OWNERS;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundDataRetentionChannels.binds>;
  }): DataRetentionChannels {
    return {
      storedBytesOwners: bound,
      storedPastRetentionOwners: {
        traces: bound.traces,
        scenarios: bound.scenarios,
        experiments: bound.experiments,
      },
    };
  }
}
