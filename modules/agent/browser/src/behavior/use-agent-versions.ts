import type { AgentVersions } from "@langwatch/agent-contract";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentClient } from "../model/agent-client.ts";

/** The label a deploy row names, and the version it points at; null when unassigned. */
export type AgentLabelSelections = Record<string, number | null>;

const EMPTY: AgentVersions = { versions: [], labels: [], availableLabels: [] };

/**
 * An agent's versions and deploy labels, and the label edits the deploy dialog saves in one go:
 * each changed label is moved or removed, and the versions are read again.
 */
export function useAgentVersions(input: {
  agents: Pick<AgentClient, "listVersions" | "assignLabel" | "removeLabel">;
  projectId: string;
  agentId: string;
}) {
  const { agents, projectId, agentId } = input;
  const [data, setData] = useState<AgentVersions>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selections, setSelections] = useState<AgentLabelSelections>({});
  const [extraLabels, setExtraLabels] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const loaded = await agents.listVersions({ projectId, agentId });
      setData(loaded);
      setSelections(selectionsOf(loaded));
      setExtraLabels([]);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [agents, projectId, agentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const labels = useMemo(
    () => [...new Set([...data.availableLabels, ...extraLabels])],
    [data.availableLabels, extraLabels],
  );

  const save = useCallback(async () => {
    const stored = selectionsOf(data);
    setIsSaving(true);
    setSaveError(null);
    try {
      await applyLabelChanges({ agents, projectId, agentId, labels, stored, wanted: selections });
      await reload();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The labels could not be saved.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [agents, agentId, data, labels, projectId, reload, selections]);

  return {
    versions: data.versions,
    latestVersion: data.versions[0]?.version ?? null,
    labels,
    selections,
    isLoading,
    isError,
    isSaving,
    saveError,
    select: (label: string, version: number | null) =>
      setSelections((current) => ({ ...current, [label]: version })),
    addLabel: (label: string) => setExtraLabels((current) => [...current, label]),
    resetSelections: () => {
      setSelections(selectionsOf(data));
      setExtraLabels([]);
      setSaveError(null);
    },
    save,
  };
}

/** Moves each label whose version changed and removes each one cleared. */
async function applyLabelChanges(input: {
  agents: Pick<AgentClient, "assignLabel" | "removeLabel">;
  projectId: string;
  agentId: string;
  labels: string[];
  stored: AgentLabelSelections;
  wanted: AgentLabelSelections;
}): Promise<void> {
  const { agents, projectId, agentId } = input;
  for (const label of input.labels) {
    const version = input.wanted[label] ?? null;
    if (version === (input.stored[label] ?? null)) continue;
    if (version === null) await agents.removeLabel({ projectId, agentId, label });
    else await agents.assignLabel({ projectId, agentId, label, version });
  }
}

function selectionsOf(versions: AgentVersions): AgentLabelSelections {
  return Object.fromEntries(versions.labels.map((label) => [label.label, label.version]));
}
