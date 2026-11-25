/**
 * How a run target sits in the experiment_runs Targets JSON. The agent label and version,
 * and the run's repeat on every target, live in `metadata`, a record every release's strict
 * target schema accepts, so a rolled back release still reads the targets of runs this one wrote.
 */

type RunTargetJson = { id: string; [key: string]: unknown };

const LABEL_KEY = "_lwAgentLabel";
const VERSION_KEY = "_lwAgentVersion";
const REPEAT_KEY = "_lwRunRepeat";

function metadataOf(target: RunTargetJson): Record<string, unknown> {
  const metadata = target.metadata;
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

/** The target as the Targets JSON stores it: label and version moved into `metadata`. */
export function storedRunTargetOf(target: RunTargetJson): RunTargetJson {
  const { agentLabel, agentVersion, ...rest } = target;
  const moved = {
    ...(typeof agentLabel === "string" ? { [LABEL_KEY]: agentLabel } : {}),
    ...(typeof agentVersion === "number" ? { [VERSION_KEY]: agentVersion } : {}),
  };
  if (Object.keys(moved).length === 0) return rest;
  return { ...rest, metadata: { ...metadataOf(target), ...moved } };
}

/** The targets of a run that repeated its rows, each carrying the repeat in `metadata`. */
export function withRunRepeat<T extends RunTargetJson>({
  targets,
  repeat,
}: {
  targets: T[];
  repeat: number | undefined;
}): T[] {
  if (repeat === undefined || repeat < 2) return targets;
  return targets.map((target) => ({
    ...target,
    metadata: { ...metadataOf(target), [REPEAT_KEY]: repeat },
  }));
}

/** The repeat a run's stored targets carry: 1 for a run that ran every row once. */
export function storedRunRepeatOf(targets: unknown): number {
  if (!Array.isArray(targets)) return 1;
  for (const target of targets) {
    if (typeof target !== "object" || target === null) continue;
    const repeat = metadataOf(target as RunTargetJson)[REPEAT_KEY];
    if (typeof repeat === "number" && Number.isInteger(repeat) && repeat > 1) return repeat;
  }
  return 1;
}

/** The target as a reader answers it: label and version back at the top level, no repeat. */
export function runTargetFromStored(target: RunTargetJson): RunTargetJson {
  const metadata = metadataOf(target);
  const label = metadata[LABEL_KEY];
  const version = metadata[VERSION_KEY];
  if (label === undefined && version === undefined && metadata[REPEAT_KEY] === undefined) {
    return target;
  }
  const {
    [LABEL_KEY]: _label,
    [VERSION_KEY]: _version,
    [REPEAT_KEY]: _repeat,
    ...remaining
  } = metadata;
  const { metadata: _metadata, ...rest } = target;
  return {
    ...rest,
    ...(typeof label === "string" ? { agentLabel: label } : {}),
    ...(typeof version === "number" ? { agentVersion: version } : {}),
    ...(Object.keys(remaining).length > 0 ? { metadata: remaining } : {}),
  };
}
