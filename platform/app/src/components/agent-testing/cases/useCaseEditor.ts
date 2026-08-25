/**
 * The state and the writes of the test case editor.
 *
 * The editor is one dialog with one draft in it. It reads the stored case when
 * it opens on one, and it saves with the version it read, so a save over
 * somebody else's newer save is refused rather than written.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-versioning.feature
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showErrorToast, readHandledError } from "~/features/errors";
import type { Scenario } from "~/generated/prisma/client";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "~/server/scenarios/parameters";
import { api } from "~/utils/api";
import {
  formatParameterLine,
  toParameterDefinitions,
} from "../run/parameter-line";

/** What a person types into the editor. */
export type CaseDraft = {
  title: string;
  situation: string;
  /** One rubric per line, as the judge reads them. */
  rubrics: string;
  labels: string[];
  /** The declared parameters as one `name=value` line. */
  parameters: string;
  folderId: string | null;
  simulatorModel: string | null;
  judgeModel: string | null;
  maxTurns: number | null;
  minTurns: number | null;
};

const EMPTY_DRAFT: CaseDraft = {
  title: "",
  situation: "",
  rubrics: "",
  labels: [],
  parameters: "",
  folderId: null,
  simulatorModel: null,
  judgeModel: null,
  maxTurns: null,
  minTurns: null,
};

/** What a stored case reads as in the editor. */
function draftFromScenario(scenario: Scenario): CaseDraft {
  return {
    title: scenario.name,
    situation: scenario.situation,
    rubrics: scenario.criteria.join("\n"),
    labels: scenario.labels,
    parameters: formatParameterLine(
      parseScenarioParameterDefinitions(scenario.parameters),
    ),
    folderId: scenario.folderId,
    simulatorModel: scenario.simulatorModel,
    judgeModel: scenario.judgeModel,
    maxTurns: scenario.maxTurns,
    minTurns: scenario.minTurns,
  };
}

/** The rubric lines a draft holds, blank lines dropped. */
export function rubricsOf(draft: CaseDraft): string[] {
  return draft.rubrics
    .split("\n")
    .map((rubric) => rubric.trim())
    .filter(Boolean);
}

export type CaseEditorState = {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  /** True while the stored case is being read. */
  isLoading: boolean;
  isSaving: boolean;
  /** The version of the case this draft was read from. */
  version: number | null;
  /** Set when somebody else saved a newer version while this one was open. */
  staleVersion: number | null;
  reloadStale: () => void;
  /** Says what a save would refuse, or nothing when the draft is complete. */
  problem: string | null;
  save: (options: { runAfter: boolean }) => void;
};

export function useCaseEditor({
  open,
  projectId,
  scenarioId,
  folderId,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  /** The case being edited, or nothing for a new one. */
  scenarioId: string | null;
  /** The suite a new case starts in. */
  folderId: string | null;
  onSaved: (saved: Scenario, options: { runAfter: boolean }) => void;
}): CaseEditorState {
  const utils = api.useUtils();
  const [draft, setDraftState] = useState<CaseDraft>(EMPTY_DRAFT);
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  // Which button started the save. The answer of the mutation is read by a
  // callback built on an earlier render, so this cannot be state.
  const runAfterSave = useRef(false);

  const {
    data: scenario,
    isLoading: isScenarioLoading,
    refetch: refetchScenario,
  } = api.scenarios.getById.useQuery(
    { projectId, id: scenarioId ?? "" },
    { enabled: open && !!projectId && !!scenarioId },
  );

  const isLoading = open && !!scenarioId && (isScenarioLoading || !scenario);

  // The draft is seeded once per case the dialog opens on. A background
  // refetch must not overwrite what somebody is typing.
  const seed = open ? (scenarioId ?? "new") : null;
  const seededFrom = useMemo(
    () => (scenarioId && scenario?.id === scenarioId ? scenario : null),
    [scenarioId, scenario],
  );

  useEffect(() => {
    if (!open) return;
    setStaleVersion(null);
    if (!scenarioId) {
      setDraftState({ ...EMPTY_DRAFT, folderId });
      return;
    }
    if (seededFrom) setDraftState(draftFromScenario(seededFrom));
    // The draft follows the case the dialog opened on, not every answer of a
    // refetch, so `seed` is what re-seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seededFrom?.id, folderId]);

  const setDraft = useCallback(
    (update: Partial<CaseDraft>) =>
      setDraftState((current) => ({ ...current, ...update })),
    [],
  );

  const invalidate = useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.folders.getAll.invalidate({ projectId });
  }, [utils, projectId]);

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (saved) => {
      invalidate();
      onSaved(saved, { runAfter: runAfterSave.current });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't create the test case" }),
  });

  const updateMutation = api.scenarios.update.useMutation({
    onSuccess: (saved) => {
      invalidate();
      utils.scenarios.getById.setData({ projectId, id: saved.id }, saved);
      void utils.scenarios.getById.invalidate({ projectId, id: saved.id });
      onSaved(saved, { runAfter: runAfterSave.current });
    },
    onError: (error) => {
      const handled = readHandledError(error);
      if (handled?.code === "scenario_stale_version") {
        const current = handled.meta.currentVersion;
        setStaleVersion(typeof current === "number" ? current : 0);
        return;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't save the test case" });
    },
  });

  const existingParameters: ScenarioParameterDefinition[] = useMemo(
    () => parseScenarioParameterDefinitions(scenario?.parameters),
    [scenario?.parameters],
  );

  const problem = useMemo(() => {
    if (!draft.title.trim()) return "A test case needs a title.";
    if (rubricsOf(draft).length === 0)
      return "A test case needs at least one rubric.";
    return null;
  }, [draft]);

  const save = useCallback(
    ({ runAfter }: { runAfter: boolean }) => {
      if (problem) return;
      runAfterSave.current = runAfter;

      const payload = {
        projectId,
        name: draft.title.trim(),
        situation: draft.situation.trim(),
        criteria: rubricsOf(draft),
        labels: draft.labels,
        parameters: toParameterDefinitions({
          line: draft.parameters,
          existing: existingParameters,
        }),
        folderId: draft.folderId,
        simulatorModel: draft.simulatorModel,
        judgeModel: draft.judgeModel,
        maxTurns: draft.maxTurns,
        minTurns: draft.minTurns,
      };

      if (scenarioId && scenario) {
        updateMutation.mutate({
          ...payload,
          id: scenarioId,
          expectedVersion: scenario.version,
        });
        return;
      }
      createMutation.mutate(payload);
    },
    [
      problem,
      projectId,
      draft,
      existingParameters,
      scenarioId,
      scenario,
      updateMutation,
      createMutation,
    ],
  );

  const reloadStale = useCallback(() => {
    void (async () => {
      const reread = await refetchScenario();
      if (reread.data) setDraftState(draftFromScenario(reread.data));
      setStaleVersion(null);
    })();
  }, [refetchScenario]);

  return {
    draft,
    setDraft,
    isLoading,
    isSaving: createMutation.isPending || updateMutation.isPending,
    version: scenario?.version ?? null,
    staleVersion,
    reloadStale,
    problem,
    save,
  };
}
