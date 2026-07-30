import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/**
 * This pipeline's two mounts (ADR-106), checked at module load rather than
 * left for a future composition root to discover wrong.
 */

/**
 * `fold` + `replace` + `aggregate` + `batch`: the only legal shape for a
 * fold. `batch` (not `none`) because a delivery may legitimately carry
 * several events for one run — the fold applies them in order as one unit of
 * work (`@langwatch/event-sourcing`'s `FoldDelivery.events`).
 */
export const experimentRunStateMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/**
 * `map` + `append` + `partition` + `batch`: each event independently
 * produces one row (no accumulator), the store's engine collapses a
 * redelivered `ProjectionId` at merge (`itemsStore.ts`), and the lane is
 * scoped to one dataset row (`groupKey.ts`) so several events for the same
 * row's evaluators can coalesce into one insert.
 */
export const experimentRunResultStorageMount: Mount = {
  projection: "map",
  store: "append",
  scope: "partition",
  collapse: "batch",
};

function assertMountIsLegal(name: string, mount: Mount): void {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `experiment-run-processing's ${name} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: "experiment_run_processing", projection: name, violations },
    );
  }
}

export function assertExperimentRunProcessingMountsAreLegal(): void {
  assertMountIsLegal("experimentRunState", experimentRunStateMount);
  assertMountIsLegal(
    "experimentRunResultStorage",
    experimentRunResultStorageMount,
  );
}
