/** The deploy label a run's agent target ran at, and the version it resolved to then. */
export type RunAgentLabel = {
  targetId: string;
  targetName: string;
  label: string;
  /** Absent for a run recorded before runs kept the resolved version. */
  version: number | null;
};

/** A run target as a run records it; only an agent target carries a label. */
export type RunTargetLike = {
  id: string;
  name: string;
  type: string;
  agentLabel?: string | null;
  agentVersion?: number | null;
};

/** "production · v3", or the label alone for a run that recorded no version. */
export function agentLabelText({
  label,
  version,
}: {
  label: string;
  version: number | null | undefined;
}): string {
  return version === null || version === undefined ? label : `${label} · v${version}`;
}

/** The label-pinned agent targets of one run, in the run's target order. */
export function runAgentLabelsOf(
  targets: readonly RunTargetLike[] | null | undefined,
): RunAgentLabel[] {
  return (targets ?? []).flatMap((target) =>
    target.type === "agent" && target.agentLabel
      ? [
          {
            targetId: target.id,
            targetName: target.name,
            label: target.agentLabel,
            version: target.agentVersion ?? null,
          },
        ]
      : [],
  );
}
