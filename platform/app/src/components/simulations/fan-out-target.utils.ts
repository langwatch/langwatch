import type { FanOutTarget } from "~/components/scenarios/services/fanOutGeneration";

type RunMetadata = {
  langwatch?: {
    targetReferenceId?: string;
    targetType?: FanOutTarget["type"];
  };
};

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
  return {
    type: langwatch.targetType,
    referenceId: langwatch.targetReferenceId,
  };
}
