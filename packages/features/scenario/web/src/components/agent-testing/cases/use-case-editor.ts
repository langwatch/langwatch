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

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "@langwatch/scenario-contract";
import { readHandledError, showErrorToast } from "../../../behavior/errors";
import type { Scenario } from "../../../model/prisma-types";
import { api } from "../../../behavior/scenario-api";
import { formatParameterLine, toParameterDefinitions } from "../run/parameter-line";
import { type CaseCustomizeBlocks, useCaseCustomizeBlocks } from "./use-case-customize-blocks";

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
    parameters: formatParameterLine(parseScenarioParameterDefinitions(scenario.parameters)),
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
  save: (options: { shouldRunAfterSave: boolean }) => void;
  /** The optional blocks the chips of the dialog open. */
  customize: CaseCustomizeBlocks;
};

/**
 * The draft the dialog holds. It is seeded once per case the dialog opens on,
 * so a background refetch cannot overwrite what somebody is typing, and the
 * version it was seeded from travels with it so a save cannot refer to a
 * newer one.
 */
function useCaseDraft({
  open,
  scenarioId,
  folderId,
  scenario,
}: {
  open: boolean;
  scenarioId: string | null;
  folderId: string | null;
  scenario: Scenario | undefined;
}) {
  const [draft, setDraftState] = useState<CaseDraft>(EMPTY_DRAFT);
  const [version, setVersion] = useState<number | null>(null);
  // Rises on every seeding, so what follows the draft knows it was replaced
  // even when the case reads at the version it read before.
  const [seedCount, setSeedCount] = useState(0);

  const seed = open ? (scenarioId ?? "new") : null;
  const seededFrom = useMemo(
    () => (scenarioId && scenario?.id === scenarioId ? scenario : null),
    [scenarioId, scenario],
  );

  const seedFrom = useCallback((stored: Scenario) => {
    setDraftState(draftFromScenario(stored));
    setVersion(stored.version);
    setSeedCount((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!scenarioId) {
      setDraftState({ ...EMPTY_DRAFT, folderId });
      setVersion(null);
      setSeedCount((count) => count + 1);
      return;
    }
    if (seededFrom) seedFrom(seededFrom);
    // The draft follows the case the dialog opened on, not every answer of a
    // refetch, so `seed` is what re-seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seededFrom?.id, folderId]);

  const setDraft = useCallback(
    (update: Partial<CaseDraft>) => setDraftState((current) => ({ ...current, ...update })),
    [],
  );

  return { draft, setDraft, version, seedCount, seedFrom };
}

/** The two writes the dialog makes, and the one refusal it can name. */
function useCaseWrites({
  projectId,
  onSaved,
  runAfterSave,
}: {
  projectId: string;
  onSaved: (saved: Scenario, options: { shouldRunAfterSave: boolean }) => void;
  runAfterSave: MutableRefObject<boolean>;
}) {
  const utils = api.useUtils();
  const [staleVersion, setStaleVersion] = useState<number | null>(null);

  const invalidate = useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.folders.getAll.invalidate({ projectId });
  }, [utils, projectId]);

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (saved) => {
      invalidate();
      onSaved(saved, { shouldRunAfterSave: runAfterSave.current });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't create the test case" }),
  });

  const updateMutation = api.scenarios.update.useMutation({
    onSuccess: (saved) => {
      invalidate();
      utils.scenarios.getById.setData({ projectId, id: saved.id }, saved);
      void utils.scenarios.getById.invalidate({ projectId, id: saved.id });
      onSaved(saved, { shouldRunAfterSave: runAfterSave.current });
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

  return { createMutation, updateMutation, staleVersion, setStaleVersion };
}

type SavePayload = ReturnType<typeof savePayload>;

/** What one save sends, out of the draft and the stored parameter types. */
function savePayload({
  projectId,
  draft,
  existingParameters,
}: {
  projectId: string;
  draft: CaseDraft;
  existingParameters: ScenarioParameterDefinition[];
}) {
  return {
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
}

/** Says what a save would refuse, or nothing when the draft is complete. */
function useCaseProblem(draft: CaseDraft): string | null {
  return useMemo(() => {
    if (!draft.title.trim()) return "A test case needs a title.";
    if (rubricsOf(draft).length === 0) return "A test case needs at least one rubric.";
    return null;
  }, [draft]);
}

/** Sends the draft: an update when it came from a stored case, else a create. */
function useCaseSave({
  problem,
  projectId,
  draft,
  existingParameters,
  scenarioId,
  version,
  runAfterSave,
  createMutation,
  updateMutation,
}: {
  problem: string | null;
  projectId: string;
  draft: CaseDraft;
  existingParameters: ScenarioParameterDefinition[];
  scenarioId: string | null;
  version: number | null;
  runAfterSave: MutableRefObject<boolean>;
  createMutation: { mutate: (input: SavePayload) => void };
  updateMutation: {
    mutate: (input: SavePayload & { id: string; expectedVersion: number }) => void;
  };
}) {
  return useCallback(
    ({ shouldRunAfterSave }: { shouldRunAfterSave: boolean }) => {
      if (problem) return;
      runAfterSave.current = shouldRunAfterSave;
      const payload = savePayload({ projectId, draft, existingParameters });

      if (scenarioId && version !== null) {
        updateMutation.mutate({
          ...payload,
          id: scenarioId,
          expectedVersion: version,
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
      version,
      runAfterSave,
      updateMutation,
      createMutation,
    ],
  );
}

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
  onSaved: (saved: Scenario, options: { shouldRunAfterSave: boolean }) => void;
}): CaseEditorState {
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

  const { draft, setDraft, version, seedCount, seedFrom } = useCaseDraft({
    open,
    scenarioId,
    folderId,
    scenario,
  });

  const customize = useCaseCustomizeBlocks({ seedCount, draft, setDraft });

  const { createMutation, updateMutation, staleVersion, setStaleVersion } = useCaseWrites({
    projectId,
    onSaved,
    runAfterSave,
  });

  useEffect(() => {
    if (open) setStaleVersion(null);
  }, [open, scenarioId, setStaleVersion]);

  const existingParameters: ScenarioParameterDefinition[] = useMemo(
    () => parseScenarioParameterDefinitions(scenario?.parameters),
    [scenario?.parameters],
  );

  const problem = useCaseProblem(draft);

  const save = useCaseSave({
    problem,
    projectId,
    draft,
    existingParameters,
    scenarioId,
    version,
    runAfterSave,
    createMutation,
    updateMutation,
  });

  const reloadStale = useCallback(() => {
    void (async () => {
      const reread = await refetchScenario();
      if (reread.data) seedFrom(reread.data);
      setStaleVersion(null);
    })();
  }, [refetchScenario, seedFrom, setStaleVersion]);

  return {
    draft,
    setDraft,
    isLoading: open && !!scenarioId && (isScenarioLoading || !scenario),
    isSaving: createMutation.isPending || updateMutation.isPending,
    version,
    staleVersion,
    reloadStale,
    problem,
    save,
    customize,
  };
}
