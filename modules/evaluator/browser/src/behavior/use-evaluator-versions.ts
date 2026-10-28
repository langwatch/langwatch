import { evaluatorClient } from "@langwatch/evaluator-client";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useCallback, useMemo, useState } from "react";

/** The label a deploy row names, and the version it points at; null when unassigned. */
export type EvaluatorLabelSelections = Record<string, number | null>;

/**
 * An evaluator's versions and deploy labels, and the label edits the deploy dialog saves in one
 * go: each changed label is moved or removed, and the versions are read again.
 */
export function useEvaluatorVersions(input: { projectId: string; evaluatorId: string }) {
  const { projectId, evaluatorId } = input;
  const utils = evaluatorClient.useUtils();
  const query = evaluatorClient.evaluators.listVersions.useQuery(
    { projectId, evaluatorId },
    { enabled: !!projectId && !!evaluatorId },
  );
  const assign = evaluatorClient.evaluators.assignLabel.useMutation();
  const remove = evaluatorClient.evaluators.removeLabel.useMutation();
  const [edits, setEdits] = useState<EvaluatorLabelSelections>({});
  const [extraLabels, setExtraLabels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stored = useMemo(() => (query.data ? selectionsOf(query.data) : {}), [query.data]);
  const selections = useMemo(() => ({ ...stored, ...edits }), [stored, edits]);

  const labels = useMemo(
    () => [...new Set([...(query.data?.availableLabels ?? []), ...extraLabels])],
    [query.data?.availableLabels, extraLabels],
  );

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await applyLabelChanges({
        assign: (label, version) => assign.mutateAsync({ projectId, evaluatorId, label, version }),
        remove: (label) => remove.mutateAsync({ projectId, evaluatorId, label }),
        labels,
        stored,
        wanted: selections,
      });
      setEdits({});
      setExtraLabels([]);
      await utils.evaluators.listVersions.invalidate({ projectId, evaluatorId });
      return true;
    } catch (error) {
      setSaveError(labelSaveErrorOf(error));
      // Earlier label calls may have landed: read the labels again; the edits stay on top.
      await utils.evaluators.listVersions.invalidate({ projectId, evaluatorId });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [assign, evaluatorId, labels, projectId, remove, selections, stored, utils]);

  const versions = query.data?.versions ?? [];
  return {
    versions,
    latestVersion: versions[0]?.version ?? null,
    labels,
    selections,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving,
    saveError,
    select: (label: string, version: number | null) =>
      setEdits((current) => ({ ...current, [label]: version })),
    addLabel: (label: string) => setExtraLabels((current) => [...current, label]),
    resetSelections: () => {
      setEdits({});
      setExtraLabels([]);
      setSaveError(null);
    },
    save,
  };
}

/** Moves each label whose version changed and removes each one cleared. */
async function applyLabelChanges(input: {
  assign: (label: string, version: number) => Promise<unknown>;
  remove: (label: string) => Promise<unknown>;
  labels: string[];
  stored: EvaluatorLabelSelections;
  wanted: EvaluatorLabelSelections;
}): Promise<void> {
  for (const label of input.labels) {
    const version = input.wanted[label] ?? null;
    if (version === (input.stored[label] ?? null)) continue;
    if (version === null) await input.remove(label);
    else await input.assign(label, version);
  }
}

function selectionsOf(versions: {
  labels: { label: string; version: number }[];
}): EvaluatorLabelSelections {
  return Object.fromEntries(versions.labels.map((label) => [label.label, label.version]));
}

/** A failed label save in words: the handled error's registered copy, never its wire text. */
function labelSaveErrorOf(error: unknown): string {
  const handled = readHandledError(error);
  if (!handled) return "The labels could not be saved.";
  const { title, description } = explainHandledError(handled);
  return description ? `${title}. ${description}` : title;
}
