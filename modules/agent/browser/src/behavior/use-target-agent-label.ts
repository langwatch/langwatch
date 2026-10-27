import { getComplexProps, getFlowCallbacks } from "@langwatch/browser-host/drawer";
import { useState } from "react";

import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";
import type { TargetEditorDrawer } from "./use-target-input-mapping.ts";

/** What the workbench's deploy label picker shows and writes; null outside the workbench. */
type TargetAgentLabel = {
  label: string | undefined;
  labels: { label: string; version: number }[];
  latestVersion: number | null;
  onChange: (label: string | undefined) => void;
};

/**
 * The deploy label an experiment target runs its agent at. The opener hands the current label
 * as `agentLabel` and a writer as the `onAgentLabelChange` flow callback; a change shows at once.
 */
export function useTargetAgentLabel({
  drawer,
  agentId,
}: {
  drawer: TargetEditorDrawer;
  agentId: string | undefined;
}): TargetAgentLabel | null {
  const host = useAgentManagementHost();
  const projectId = host.project()?.id ?? "";
  const opened = getComplexProps().agentLabel as string | undefined;
  const [shown, setShown] = useState({ opened, label: opened });
  if (shown.opened !== opened) setShown({ opened, label: opened });
  const write = getFlowCallbacks(drawer)?.onAgentLabelChange as
    | ((label: string | undefined) => void)
    | undefined;
  const versions = agentApi.agents.listVersions.useQuery(
    { projectId, agentId: agentId ?? "" },
    { enabled: Boolean(write && agentId && projectId) },
  );
  if (!write || !agentId) return null;

  return {
    label: shown.label,
    labels: (versions.data?.labels ?? []).map(({ label, version }) => ({ label, version })),
    latestVersion: versions.data?.versions[0]?.version ?? null,
    onChange: (label) => {
      setShown((current) => ({ ...current, label }));
      write(label);
    },
  };
}
