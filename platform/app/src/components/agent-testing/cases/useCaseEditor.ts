/**
 * The state and the writes of the scenario editor.
 *
 * The editor is one dialog with one draft in it. It reads the stored scenario when
 * it opens on one, and it saves with the version it read, so a save over
 * somebody else's newer save is refused rather than written.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-versioning.feature
 */

import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  describeError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import type { Scenario } from "~/generated/prisma/client";
import {
  parseScenarioParameterDefinitions,
  type ScenarioParameterDefinition,
} from "~/server/scenarios/parameters";
import {
  coerceFieldValue,
  parseScenarioFieldValues,
  type ScenarioFieldValues,
  type SuiteFieldDefinition,
} from "~/server/scenarios/suite-fields";
import { api } from "~/utils/api";
import {
  formatParameterLine,
  toParameterDefinitions,
} from "../run/parameter-line";
import type { TestSuiteEntry } from "./test-cases";
import {
  type CaseCustomizeBlocks,
  useCaseCustomizeBlocks,
} from "./useCaseCustomizeBlocks";

/** What a person types into the editor. */
export type CaseDraft = {
  title: string;
  situation: string;
  /** One criterion per line, as the judge reads them. */
  criteria: string;
  labels: string[];
  /** The declared parameters as one `name=value` line. */
  parameters: string;
  /**
   * The values of the suite's fields, keyed by identifier, as typed. A value
   * for a field the suite no longer declares stays until it is removed.
   */
  fields: ScenarioFieldValues;
  testSuiteId: string | null;
  simulatorModel: string | null;
  judgeModel: string | null;
  maxTurns: number | null;
  minTurns: number | null;
};

const EMPTY_DRAFT: CaseDraft = {
  title: "",
  situation: "",
  criteria: "",
  labels: [],
  parameters: "",
  fields: {},
  testSuiteId: null,
  simulatorModel: null,
  judgeModel: null,
  maxTurns: null,
  minTurns: null,
};

/** What a stored scenario reads as in the editor. */
function draftFromScenario(scenario: Scenario): CaseDraft {
  return {
    title: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria.join("\n"),
    labels: scenario.labels,
    parameters: formatParameterLine(
      parseScenarioParameterDefinitions(scenario.parameters),
    ),
    fields: parseScenarioFieldValues(scenario.fields),
    testSuiteId: scenario.testSuiteId,
    simulatorModel: scenario.simulatorModel,
    judgeModel: scenario.judgeModel,
    maxTurns: scenario.maxTurns,
    minTurns: scenario.minTurns,
  };
}

/** The criteria a draft holds, blank lines dropped. */
export function criteriaOf(draft: CaseDraft): string[] {
  return draft.criteria
    .split("\n")
    .map((criterion) => criterion.trim())
    .filter(Boolean);
}

/**
 * The values the save sends: each declared field read as its own type, with
 * blanks dropped, and every value of a field the suite no longer declares
 * left as it is, so the server can refuse it by name.
 */
export function fieldValuesForSave({
  values,
  definitions,
}: {
  values: ScenarioFieldValues;
  definitions: readonly SuiteFieldDefinition[];
}): ScenarioFieldValues {
  const declared = new Set(definitions.map((field) => field.identifier));
  const saved: ScenarioFieldValues = {};
  for (const definition of definitions) {
    const value = coerceFieldValue({
      definition,
      raw: values[definition.identifier],
    });
    if (value !== undefined) saved[definition.identifier] = value;
  }
  for (const [identifier, value] of Object.entries(values)) {
    if (!declared.has(identifier)) saved[identifier] = value;
  }
  return saved;
}

/** The values of fields the suite does not declare, keyed by identifier. */
export function strayFieldValues({
  values,
  definitions,
}: {
  values: ScenarioFieldValues;
  definitions: readonly SuiteFieldDefinition[];
}): ScenarioFieldValues {
  const declared = new Set(definitions.map((field) => field.identifier));
  return Object.fromEntries(
    Object.entries(values).filter(([identifier]) => !declared.has(identifier)),
  );
}

export type CaseEditorState = {
  draft: CaseDraft;
  setDraft: (update: Partial<CaseDraft>) => void;
  /** The fields the suite of the draft declares, one control each. */
  fieldDefinitions: SuiteFieldDefinition[];
  /** What the server refused about the field values, if anything. */
  fieldsError: string | null;
  /** True while the stored scenario is being read. */
  isLoading: boolean;
  isSaving: boolean;
  /** The version of the scenario this draft was read from. */
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
 * The draft the dialog holds. It is seeded once per scenario the dialog opens on,
 * so a background refetch cannot overwrite what somebody is typing, and the
 * version it was seeded from travels with it so a save cannot refer to a
 * newer one.
 */
function useCaseDraft({
  open,
  scenarioId,
  testSuiteId,
  scenario,
}: {
  open: boolean;
  scenarioId: string | null;
  testSuiteId: string | null;
  scenario: Scenario | undefined;
}) {
  const [draft, setDraftState] = useState<CaseDraft>(EMPTY_DRAFT);
  const [version, setVersion] = useState<number | null>(null);
  // Rises on every seeding, so what follows the draft knows it was replaced
  // even when the scenario reads at the version it read before.
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
      setDraftState({ ...EMPTY_DRAFT, testSuiteId });
      setVersion(null);
      setSeedCount((count) => count + 1);
      return;
    }
    if (seededFrom) seedFrom(seededFrom);
    // The draft follows the scenario the dialog opened on, not every answer of a
    // refetch, so `seed` is what re-seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, seededFrom?.id, testSuiteId]);

  const setDraft = useCallback(
    (update: Partial<CaseDraft>) =>
      setDraftState((current) => ({ ...current, ...update })),
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
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  /** A refusal about the field values reads under them; anything else toasts. */
  const surfaceError = useCallback((error: unknown, fallbackTitle: string) => {
    const handled = readHandledError(error);
    if (
      handled?.code === "scenario_field_unknown" ||
      handled?.code === "scenario_field_type_invalid"
    ) {
      setFieldsError(describeError({ error }));
      return;
    }
    showErrorToast({ error, fallbackTitle });
  }, []);

  const invalidate = useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.testSuites.getAll.invalidate({ projectId });
  }, [utils, projectId]);

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (saved) => {
      invalidate();
      onSaved(saved, { shouldRunAfterSave: runAfterSave.current });
    },
    onError: (error) => surfaceError(error, "Couldn't create the scenario"),
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
      surfaceError(error, "Couldn't save the scenario");
    },
  });

  return {
    createMutation,
    updateMutation,
    staleVersion,
    setStaleVersion,
    fieldsError,
    setFieldsError,
  };
}

type SavePayload = ReturnType<typeof savePayload>;

/** What one save sends, out of the draft and the stored parameter types. */
function savePayload({
  projectId,
  draft,
  existingParameters,
  fieldDefinitions,
}: {
  projectId: string;
  draft: CaseDraft;
  existingParameters: ScenarioParameterDefinition[];
  fieldDefinitions: SuiteFieldDefinition[];
}) {
  return {
    projectId,
    name: draft.title.trim(),
    situation: draft.situation.trim(),
    criteria: criteriaOf(draft),
    labels: draft.labels,
    parameters: toParameterDefinitions({
      line: draft.parameters,
      existing: existingParameters,
    }),
    fields: fieldValuesForSave({
      values: draft.fields,
      definitions: fieldDefinitions,
    }),
    testSuiteId: draft.testSuiteId,
    simulatorModel: draft.simulatorModel,
    judgeModel: draft.judgeModel,
    maxTurns: draft.maxTurns,
    minTurns: draft.minTurns,
  };
}

/** Says what a save would refuse, or nothing when the draft is complete. */
function useCaseProblem(draft: CaseDraft): string | null {
  return useMemo(() => {
    if (!draft.title.trim()) return "A scenario needs a title.";
    if (criteriaOf(draft).length === 0)
      return "A scenario needs at least one criterion.";
    return null;
  }, [draft]);
}

/** Sends the draft: an update when it came from a stored scenario, else a create. */
function useCaseSave({
  problem,
  projectId,
  draft,
  existingParameters,
  fieldDefinitions,
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
  fieldDefinitions: SuiteFieldDefinition[];
  scenarioId: string | null;
  version: number | null;
  runAfterSave: MutableRefObject<boolean>;
  createMutation: { mutate: (input: SavePayload) => void };
  updateMutation: {
    mutate: (
      input: SavePayload & { id: string; expectedVersion: number },
    ) => void;
  };
}) {
  return useCallback(
    ({ shouldRunAfterSave }: { shouldRunAfterSave: boolean }) => {
      if (problem) return;
      runAfterSave.current = shouldRunAfterSave;
      const payload = savePayload({
        projectId,
        draft,
        existingParameters,
        fieldDefinitions,
      });

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
      fieldDefinitions,
      scenarioId,
      version,
      runAfterSave,
      updateMutation,
      createMutation,
    ],
  );
}

/** The stored scenario the dialog reads, when it opens on one. */
function useCaseScenarioQuery({
  open,
  projectId,
  scenarioId,
}: {
  open: boolean;
  projectId: string;
  scenarioId: string | null;
}) {
  const {
    data: scenario,
    isLoading: isScenarioLoading,
    refetch,
  } = api.scenarios.getById.useQuery(
    { projectId, id: scenarioId ?? "" },
    { enabled: open && !!projectId && !!scenarioId },
  );
  return { scenario, isScenarioLoading, refetchScenario: refetch };
}

/** Clears the stale-version and field refusals each time the dialog opens on a scenario. */
function useCaseErrorReset({
  open,
  scenarioId,
  setStaleVersion,
  setFieldsError,
}: {
  open: boolean;
  scenarioId: string | null;
  setStaleVersion: (value: number | null) => void;
  setFieldsError: (value: string | null) => void;
}) {
  useEffect(() => {
    if (open) {
      setStaleVersion(null);
      setFieldsError(null);
    }
  }, [open, scenarioId, setStaleVersion, setFieldsError]);
}

/**
 * The fields of the draft's suite, and the parameter types already stored.
 * The fields follow the suite the draft is filed in, so moving the scenario
 * to another suite asks for that suite's fields.
 */
function useCaseDerived({
  suites,
  draft,
  scenario,
}: {
  suites: TestSuiteEntry[];
  draft: CaseDraft;
  scenario: Scenario | undefined;
}) {
  const fieldDefinitions = useMemo(
    () => suites.find((suite) => suite.id === draft.testSuiteId)?.fields ?? [],
    [suites, draft.testSuiteId],
  );
  const existingParameters: ScenarioParameterDefinition[] = useMemo(
    () => parseScenarioParameterDefinitions(scenario?.parameters),
    [scenario?.parameters],
  );
  const problem = useCaseProblem(draft);
  return { fieldDefinitions, existingParameters, problem };
}

/** Rereads the scenario, seeds the draft from it, and clears the stale flag. */
function useCaseReload<T extends { data: Scenario | undefined }>({
  refetchScenario,
  seedFrom,
  setStaleVersion,
}: {
  refetchScenario: () => Promise<T>;
  seedFrom: (stored: Scenario) => void;
  setStaleVersion: (value: number | null) => void;
}) {
  return useCallback(() => {
    void (async () => {
      const reread = await refetchScenario();
      if (reread.data) seedFrom(reread.data);
      setStaleVersion(null);
    })();
  }, [refetchScenario, seedFrom, setStaleVersion]);
}

export function useCaseEditor({
  open,
  projectId,
  scenarioId,
  testSuiteId,
  suites,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  /** The scenario being edited, or nothing for a new one. */
  scenarioId: string | null;
  /** The suite a new scenario starts in. */
  testSuiteId: string | null;
  /** The test suites of the project, for the fields the draft's suite declares. */
  suites: TestSuiteEntry[];
  onSaved: (saved: Scenario, options: { shouldRunAfterSave: boolean }) => void;
}): CaseEditorState {
  // Which button started the save. The answer of the mutation is read by a
  // callback built on an earlier render, so this cannot be state.
  const runAfterSave = useRef(false);

  const { scenario, isScenarioLoading, refetchScenario } = useCaseScenarioQuery(
    { open, projectId, scenarioId },
  );

  const { draft, setDraft, version, seedCount, seedFrom } = useCaseDraft({
    open,
    scenarioId,
    testSuiteId,
    scenario,
  });

  const customize = useCaseCustomizeBlocks({ seedCount, draft, setDraft });

  const {
    createMutation,
    updateMutation,
    staleVersion,
    setStaleVersion,
    fieldsError,
    setFieldsError,
  } = useCaseWrites({ projectId, onSaved, runAfterSave });

  useCaseErrorReset({ open, scenarioId, setStaleVersion, setFieldsError });

  const { fieldDefinitions, existingParameters, problem } = useCaseDerived({
    suites,
    draft,
    scenario,
  });

  const save = useCaseSave({
    problem,
    projectId,
    draft,
    existingParameters,
    fieldDefinitions,
    scenarioId,
    version,
    runAfterSave,
    createMutation,
    updateMutation,
  });

  const reloadStale = useCaseReload({
    refetchScenario,
    seedFrom,
    setStaleVersion,
  });

  return {
    draft,
    setDraft,
    fieldDefinitions,
    fieldsError,
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
