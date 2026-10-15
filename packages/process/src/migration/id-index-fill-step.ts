/**
 * The background step a module's `.withIdIndexes(...)` contributes: fills its declared id
 * indexes from rows older than their views on every ClickHouse target, raises their retention,
 * then writes their ready markers (dev/docs/plans/id-index-2026-10-10.md §3).
 */
import {
  type ClickHouseQueryClient,
  fillOwnerIdIndexes,
  fillReportOf,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  type IdIndexOwnerFill,
  type IdIndexRetentionRaise,
} from "@langwatch/clickhouse-client";
import type { ModuleApiToken } from "@langwatch/module";

/** The step's kebab name when a module names none: `<module>:fill-id-indexes`. */
export const ID_INDEX_FILL_STEP = "fill-id-indexes";

/**
 * How the composition raises an index's retention before its markers: an application passes a
 * function that calls the retention owner's API, resolved when the step runs.
 */
export type IdIndexRetention = (input: {
  api: <Api>(token: ModuleApiToken<Api>) => Api;
}) => IdIndexRetentionRaise;

/** What `.withIdIndexes` takes beside the declarations: the step's name and its predecessors. */
export type IdIndexFillOptions = Readonly<{
  /** The steps this fill runs after, by id: the previous owner's fill. */
  after?: readonly string[] | undefined;
  /** The step's kebab name; `fill-id-indexes` unless a shipped id says otherwise. */
  step?: string | undefined;
  /** The step's line in the ledger and Ops; one naming the indexes unless a shipped one exists. */
  description?: string | undefined;
}>;

/** The step, shaped as the upgrade runner reads a declared background data step. */
export type IdIndexFillStep = Readonly<{
  id: string;
  kind: "data";
  mode: "background";
  description: string;
  needsOldWritersGone: false;
  after?: readonly string[];
  run: (
    input: Pick<IdIndexOwnerFill, "checkpoint" | "dryRun" | "signal">,
  ) => Promise<IdIndexFillReport>;
}>;

/** Thrown by a live fill whose process composed no retention raise: retention would be lost. */
export class IdIndexRetentionUnavailableError extends Error {
  constructor(readonly step: string) {
    super(
      `Migration step "${step}" needs the id-index retention raise, which this process did not compose (withIdIndexRetention).`,
    );
    this.name = "IdIndexRetentionUnavailableError";
  }
}

/**
 * One module's fill step over its declarations. Over memory stores there is no ClickHouse and
 * nothing to fill, so the step reports an empty walk.
 */
export function idIndexFillStep({
  module,
  indexes,
  options,
  clickhouse,
  raise,
}: {
  module: string;
  indexes: readonly IdIndexDeclaration[];
  options: IdIndexFillOptions;
  clickhouse: ClickHouseQueryClient | undefined;
  raise: IdIndexRetentionRaise | undefined;
}): IdIndexFillStep {
  const id = `${module}:${options.step ?? ID_INDEX_FILL_STEP}`;
  const after = options.after ?? [];
  return {
    id,
    kind: "data",
    mode: "background",
    description:
      options.description ??
      `Fills ${indexes.map((index) => index.index).join(", ")} from rows older than their views, then marks each ready per ClickHouse target.`,
    // Old releases fire the same server-side views, so nothing waits for them to leave.
    needsOldWritersGone: false,
    ...(after.length === 0 ? {} : { after }),
    // Level-triggered: min/max merge, so a rerun changes no range and resumes at its cursor.
    run: async ({ checkpoint, dryRun, signal }) => {
      if (clickhouse === undefined) return fillReportOf({ resumeFrom: null });
      if (raise === undefined) throw new IdIndexRetentionUnavailableError(id);
      return fillOwnerIdIndexes({
        clickhouse,
        indexes,
        checkpoint,
        dryRun,
        signal,
        raiseRetention: raise,
      });
    },
  };
}
