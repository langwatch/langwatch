/**
 * How a run target sits in the experiment_runs Targets JSON. The agent label and version
 * live in `metadata`, a record every release's strict target schema accepts, so a rolled
 * back release still reads the targets of runs this one wrote.
 */

type RunTargetJson = { id: string; [key: string]: unknown };

const LABEL_KEY = "agentLabel";
const VERSION_KEY = "agentVersion";

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

/** The target as a reader answers it: label and version back at the top level. */
export function runTargetFromStored(target: RunTargetJson): RunTargetJson {
  const metadata = metadataOf(target);
  const label = metadata[LABEL_KEY];
  const version = metadata[VERSION_KEY];
  if (label === undefined && version === undefined) return target;
  const { [LABEL_KEY]: _label, [VERSION_KEY]: _version, ...remaining } = metadata;
  const { metadata: _metadata, ...rest } = target;
  return {
    ...rest,
    ...(typeof label === "string" ? { agentLabel: label } : {}),
    ...(typeof version === "number" ? { agentVersion: version } : {}),
    ...(Object.keys(remaining).length > 0 ? { metadata: remaining } : {}),
  };
}
