import type { FanOutTarget } from "~/components/scenarios/services/fanOutGeneration";

type RunMetadata = {
  langwatch?: {
    targetReferenceId?: string;
    targetType?: string;
  };
};

/**
 * Run metadata is stored as JSON, so the type on the way out is a claim rather
 * than a guarantee. An unrecognised value is treated as "we don't know".
 */
const TARGET_TYPES: readonly FanOutTarget["type"][] = [
  "prompt",
  "http",
  "code",
  "workflow",
];

/**
 * The target a fan-out seeded from this run can inherit.
 *
 * Returns undefined when the run did not record enough to say. That is a
 * "we don't know" rather than a "there is none": the caller asks the user
 * instead of hiding the entry point, because a run dispatched before the
 * platform recorded target types is still a failure worth fanning out from.
 */
export function fanOutTargetFromRunMetadata(
  metadata: RunMetadata | null | undefined,
): FanOutTarget | undefined {
  const langwatch = metadata?.langwatch;
  if (!langwatch?.targetReferenceId || !langwatch.targetType) return undefined;

  const type = TARGET_TYPES.find((known) => known === langwatch.targetType);
  if (!type) return undefined;

  return { type, referenceId: langwatch.targetReferenceId };
}
