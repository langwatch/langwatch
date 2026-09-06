/**
 * The state of an open run dialog: the fields it holds, the targets it can
 * offer, the parameter overrides, and the chips that add them.
 *
 * The fields reset once per subject, so opening the dialog on another suite
 * or scenario starts from that subject's remembered target.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 * @see specs/suites/run-notes.feature
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { useFilteredAgents } from "~/components/scenarios/useFilteredScenarioTargets";
import {
  type DeclaredParameter,
  unionParameterDefinitions,
} from "~/components/suites/useRunSuite";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { declaredDefaults } from "~/server/suites/target-key";
import { api } from "~/utils/api";
import { useSession } from "~/utils/auth-client";
import type { CustomizeChip } from "../shared/CustomizeChips";
import { applyConfigurationTo } from "./apply-configuration";
import {
  type CompareRow,
  compareRowParameters,
  type ParameterDefaults,
} from "./compare-rows";
import type { PromptEntry } from "./PromptPicker";
import {
  formatParameterLine,
  formatStoredParameterLine,
  toLineRunParameters,
} from "./parameter-line";
import {
  canCollapseRows,
  lineFromRows,
  missingSecretRowNames,
  type ParameterRow,
  rowsFromLine,
  storableSecretRowNames,
  toRowsRunParameters,
  toStorableRowParameters,
} from "./parameter-rows";
import type { ParameterFieldError } from "./parameter-suggestions";
import { type ScopeScenario, scenariosInScope } from "./RunScopeSection";
import type { RunDialogAgent } from "./RunTargetPicker";
import { normaliseRunScope, type RunScope } from "./run-configuration";
import type {
  RunDialogMode,
  RunDialogSubject,
  RunTarget,
} from "./run-dialog-types";
import {
  lineWithoutUndeclared,
  undeclaredNamesOnLine,
  undeclaredNamesOnRows,
  undeclaredParameterMessage,
} from "./undeclared-parameters";
import { useCompareRows } from "./useCompareRows";
import { useRunConfigurationHistory } from "./useRunConfigurationHistory";
import { useRunHistorySeed } from "./useRunHistorySeed";
import { buildTargetLabels, scopeLabelOf, useRunName } from "./useRunName";
import { type RunPlanFields, useRunPlanFields } from "./useRunPlanFields";

/** One key per subject the dialog can be open on, "closed" when it is not. */
function subjectKeyOf(subject: RunDialogSubject | null): string {
  if (!subject) return "closed";
  if (subject.kind === "plan") return "plan";
  if (subject.kind === "all") return "all";
  if (subject.kind === "suite") return `suite:${subject.suiteId}`;
  return `case:${subject.scenarioId}`;
}

/** The scenarios a run of this subject covers. */
function scenarioIdsOfSubject(
  subject: RunDialogSubject | null,
  allScenarios: readonly { id: string }[],
): string[] {
  if (!subject) return [];
  if (subject.kind === "case") return [subject.scenarioId];
  if (subject.kind === "suite") return subject.scenarioIds;
  return allScenarios.map((scenario) => scenario.id);
}

/** The scenarios in the dialog's scope, which only New run plan can narrow. */
function scopedScenarioIds({
  subject,
  scope,
  scenarios,
  allScenarios,
}: {
  subject: RunDialogSubject | null;
  scope: RunScope;
  scenarios: readonly ScopeScenario[];
  allScenarios: readonly { id: string }[];
}): string[] {
  if (subject?.kind === "plan") {
    return scenariosInScope({ scope, scenarios });
  }
  return scenarioIdsOfSubject(subject, allScenarios);
}

/**
 * The parameter overrides the subject remembers, as the line the dialog
 * opens on. Nothing remembered means the parameter block stays folded away.
 */
function rememberedParameterLine(subject: RunDialogSubject | null): string {
  if (subject?.kind !== "suite") return "";
  const values = subject.persistedTarget?.runParameters;
  if (!values || Object.keys(values).length === 0) return "";
  return formatStoredParameterLine(values);
}

/**
 * The secret rows the subject remembers, by name and with no value.
 *
 * A run never writes a secret value down, so the row comes back empty and the
 * next run asks for the value again.
 */
function rememberedSecretRows(
  subject: RunDialogSubject | null,
): ParameterRow[] {
  if (subject?.kind !== "suite") return [];
  const names = subject.persistedTarget?.runSecretParameterNames ?? [];
  return names.map((name) => ({ name, value: "", secret: true }));
}

/** The parameter block as the subject remembers it, block by block. */
function rememberedParameters(subject: RunDialogSubject | null) {
  const line = rememberedParameterLine(subject);
  const secretRows = rememberedSecretRows(subject);
  const hasSecretRows = secretRows.length > 0;
  return {
    show: line !== "" || hasSecretRows,
    line,
    rowsRequested: hasSecretRows,
    rows: hasSecretRows ? [...rowsFromLine(line), ...secretRows] : null,
  };
}

/** The state of the parameter block: its line, its rows and its secrets. */
function useParameterFieldsState() {
  const [parameterLine, setParameterLine] = useState("");
  // False while the line is the one the dialog wrote itself, from what the
  // subject remembers or from a stored configuration. Only a line the dialog
  // wrote may be shortened when the agent cannot read what is on it.
  const [parameterLineTyped, setParameterLineTyped] = useState(false);
  // Null while the line is what the block holds: the rows are read off the
  // line until something is typed into one of them.
  const [parameterRows, setParameterRows] = useState<ParameterRow[] | null>(
    null,
  );
  const [rowsRequested, setRowsRequested] = useState(false);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});

  return {
    parameterLine,
    setParameterLine,
    parameterLineTyped,
    setParameterLineTyped,
    parameterRows,
    setParameterRows,
    rowsRequested,
    setRowsRequested,
    secretValues,
    setSecretValues,
  };
}

/** The fields of the dialog, reset whenever it opens on a new subject. */
function useRunDialogFields(subject: RunDialogSubject | null) {
  const [target, setTarget] = useState<TargetValue>(null);
  const [mode, setMode] = useState<RunDialogMode>("agents");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showParams, setShowParams] = useState(false);
  const parameterFields = useParameterFieldsState();
  const [inlineError, setInlineError] = useState<unknown>(null);
  // A refusal that names one parameter reads under the field that holds it.
  const [parameterError, setParameterError] =
    useState<ParameterFieldError | null>(null);
  const [missingProvider, setMissingProvider] = useState(false);
  // The subject the fields below already hold the opening values of. Anything
  // that reads the fields waits for this, because the reset runs in an effect
  // and the render that opens the dialog is one render ahead of it.
  const [resetFor, setResetFor] = useState("closed");
  const agentTargetBeforePrompt = useRef<TargetValue>(null);

  const subjectKey = subjectKeyOf(subject);
  const initialTarget = subject?.initialTarget ?? null;
  const remembered = rememberedParameters(subject);
  useEffect(() => {
    setTarget(initialTarget);
    setMode(initialTarget?.type === "prompt" ? "prompts" : "agents");
    // The note is the one field a run never remembers: it says what this run
    // is for, so it starts empty every time.
    setShowNote(false);
    setNote("");
    setShowParams(remembered.show);
    parameterFields.setParameterLine(remembered.line);
    parameterFields.setParameterLineTyped(false);
    parameterFields.setRowsRequested(remembered.rowsRequested);
    parameterFields.setParameterRows(remembered.rows);
    parameterFields.setSecretValues({});
    setInlineError(null);
    setParameterError(null);
    setMissingProvider(false);
    setResetFor(subjectKey);
    agentTargetBeforePrompt.current = null;
    // Reset exactly once per subject; the target of a subject does not move
    // under an open dialog.
  }, [subjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    target,
    setTarget,
    mode,
    setMode,
    showNote,
    setShowNote,
    note,
    setNote,
    showParams,
    setShowParams,
    ...parameterFields,
    inlineError,
    setInlineError,
    parameterError,
    setParameterError,
    missingProvider,
    setMissingProvider,
    resetFor,
    agentTargetBeforePrompt,
  };
}

export type RunDialogFields = ReturnType<typeof useRunDialogFields>;

/** The agents, the published prompts and the scenarios the project holds. */
function useRunDialogChoices(subject: RunDialogSubject | null) {
  const { project } = useOrganizationTeamProject();
  // Who is looking: a development agent of another person is theirs to run.
  const { data: session } = useSession();
  const viewerUserId = session?.user?.id ?? null;
  const projectId = project?.id ?? "";
  const isDialogOpen = !!project && !!subject;

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId },
    { enabled: isDialogOpen },
  );
  const scenarioAgents = useFilteredAgents({
    agents,
    searchValue: "",
    viewerUserId,
  });
  const { data: prompts } = useAllPromptsForProject();
  const { data: allScenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: isDialogOpen },
  );
  // Only the New run plan entry point names test suites, but the run name of
  // every entry point can read one, so the list is read whenever it is open.
  const { data: testSuites } = api.suites.testSuites.getAll.useQuery(
    { projectId },
    { enabled: isDialogOpen },
  );

  const publishedPrompts: PromptEntry[] = useMemo(
    () =>
      (prompts ?? [])
        .filter((prompt) => prompt.version > 0)
        .map((prompt) => ({
          id: prompt.id,
          handle: prompt.handle,
          version: prompt.version,
        })),
    [prompts],
  );

  const scopeScenarios: ScopeScenario[] = useMemo(
    () =>
      (allScenarios ?? []).map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        testSuiteId: scenario.testSuiteId ?? null,
        labels: scenario.labels ?? [],
      })),
    [allScenarios],
  );

  return {
    scenarioAgents,
    publishedPrompts,
    allScenarios,
    testSuites: testSuites ?? [],
    scopeScenarios,
    /**
     * Whether the two reads that hold every declaration have answered. Until
     * they do, a name the dialog cannot find is not an unknown name.
     */
    areChoicesLoaded: agents !== undefined && allScenarios !== undefined,
  };
}

/**
 * The declared default of every plain parameter the run can carry.
 *
 * A value typed equal to its default is no override: the dialog keys, sorts
 * and names a target the way the server does, without it.
 */
function useParameterDefaults(
  definitions: readonly DeclaredParameter[],
): ParameterDefaults {
  return useMemo(() => declaredDefaults(definitions), [definitions]);
}

/**
 * The agents the run goes against right now: the one chosen, or the agents
 * of the comparison rows. A prompt declares no parameter and is left out.
 */
function targetAgentIdsOf({
  target,
  compareRows,
}: {
  target: TargetValue;
  compareRows: readonly CompareRow[];
}): string[] {
  const targets =
    compareRows.length > 0 ? compareRows.map((row) => row.target) : [target];
  const ids = targets.flatMap((entry) =>
    entry && entry.type !== "prompt" ? [entry.id] : [],
  );
  return [...new Set(ids)].sort();
}

/**
 * The parameters in scope: what the scenarios of the run declare plus what the
 * agents it goes against declare, and the secrets among them.
 */
function useDeclaredParameters({
  scenarioIds,
  allScenarios,
  agents,
  targetAgentIds,
}: {
  scenarioIds: string[];
  allScenarios: readonly { id: string; parameters: unknown }[] | undefined;
  agents: readonly RunDialogAgent[];
  /** The ids of the agents the run goes against, sorted. */
  targetAgentIds: readonly string[];
}) {
  const targetAgentKey = targetAgentIds.join(",");
  const parameterDefinitions = useMemo(() => {
    const inRun = new Set(targetAgentKey.split(","));
    return unionParameterDefinitions({
      scenarioIds,
      scenarios: allScenarios ?? [],
      agents: agents.filter((agent) => inRun.has(agent.id)),
    });
  }, [scenarioIds, allScenarios, agents, targetAgentKey]);

  /** The declared parameters of the run against one agent alone. */
  const declaredParametersOf = useCallback(
    (agentId: string): DeclaredParameter[] =>
      unionParameterDefinitions({
        scenarioIds,
        scenarios: allScenarios ?? [],
        agents: agents.filter((agent) => agent.id === agentId),
      }),
    [scenarioIds, allScenarios, agents],
  );

  // The line a single input can carry, and the secrets that cannot ride on it.
  const secretDefinitions = useMemo(
    () =>
      parameterDefinitions.filter((definition) => definition.secret === true),
    [parameterDefinitions],
  );

  return { parameterDefinitions, declaredParametersOf, secretDefinitions };
}

/** The agent the run goes against, as the dialog names it. */
function targetLabelOf({
  target,
  agents,
}: {
  target: TargetValue;
  agents: readonly RunDialogAgent[];
}): string | null {
  if (!target || target.type === "prompt") return null;
  const agent = agents.find((candidate) => candidate.id === target.id);
  if (!agent) return null;
  return agent.label ?? agent.name;
}

/**
 * The plain overrides the block holds that nothing in the run declares.
 *
 * A line the dialog wrote itself is shortened to what the run can read. A run
 * remembers the values of the agent it went against, so opening the dialog on
 * another agent would otherwise carry them to one whose function has no
 * parameter by that name, and the run would be refused the moment it started.
 *
 * A line somebody wrote is left as it is and read back to them instead: a
 * value that was typed is never taken away in silence, and a name the run
 * cannot read still goes out, so the server refuses it by name rather than
 * the dialog dropping it. The field says so first, under the value itself.
 */
function useUndeclaredParameters({
  fields,
  definitions,
  rows,
  showParameterRows,
  hasDeclaredSecrets,
  agents,
  isLoaded,
  isCompare,
}: {
  fields: RunDialogFields;
  definitions: readonly DeclaredParameter[];
  rows: readonly ParameterRow[];
  showParameterRows: boolean;
  /** Whether a declared secret holds the block open on its own. */
  hasDeclaredSecrets: boolean;
  agents: readonly RunDialogAgent[];
  /** Whether the reads that hold the declarations have answered. */
  isLoaded: boolean;
  isCompare: boolean;
}): ParameterFieldError | null {
  const { parameterLine, parameterLineTyped, setParameterLine } = fields;
  const { showParams, setShowParams, rowsRequested, target } = fields;
  // A comparison keeps its plain values on the rows of its targets, each one
  // read against its own agent, so this block holds the secrets alone.
  const isActive = isLoaded && showParams && !isCompare;

  useEffect(() => {
    if (!isActive || parameterLineTyped) return;
    const shortened = lineWithoutUndeclared({
      line: parameterLine,
      definitions,
    });
    if (shortened === parameterLine) return;
    setParameterLine(shortened);
    // A block that held remembered values alone has nothing left to say, so
    // it folds away and the chip offers it again.
    if (shortened === "" && !rowsRequested && !hasDeclaredSecrets) {
      setShowParams(false);
    }
  }, [
    isActive,
    parameterLineTyped,
    parameterLine,
    definitions,
    rowsRequested,
    hasDeclaredSecrets,
    setParameterLine,
    setShowParams,
  ]);

  const names = useMemo(() => {
    if (!isActive) return [];
    return showParameterRows
      ? undeclaredNamesOnRows({ rows, definitions })
      : undeclaredNamesOnLine({ line: parameterLine, definitions });
  }, [isActive, showParameterRows, rows, parameterLine, definitions]);

  return useMemo(() => {
    const [first] = names;
    if (first === undefined) return null;
    return {
      name: first,
      message: undeclaredParameterMessage({
        names,
        targetLabel: targetLabelOf({ target, agents }),
      }),
    };
  }, [names, target, agents]);
}

/**
 * The secrets of the block: their values, whether the run still waits for one,
 * and whether the block may fold back into its single line.
 *
 * A declared secret holds the block in its rows, since a value that must stay
 * hidden cannot be read on a line beside the plain ones.
 */
function useSecretParameterFields({
  fields,
  secretDefinitions,
  rows,
  showParameterRows,
  isCompare,
}: {
  fields: RunDialogFields;
  secretDefinitions: readonly DeclaredParameter[];
  rows: ParameterRow[];
  showParameterRows: boolean;
  isCompare: boolean;
}) {
  const { showParams, secretValues, setSecretValues } = fields;

  const setSecretValue = useCallback(
    (name: string, value: string) => {
      setSecretValues((previous) => ({ ...previous, [name]: value }));
    },
    [setSecretValues],
  );

  const isCollecting = showParams || isCompare;
  const declaredWithoutValue = secretDefinitions.some(
    (definition) => (secretValues[definition.name] ?? "") === "",
  );
  const rowWithoutValue =
    (showParameterRows || isCompare) && missingSecretRowNames(rows).length > 0;

  return {
    setSecretValue,
    hasMissingSecrets:
      isCollecting && (declaredWithoutValue || rowWithoutValue),
    /** Whether the block may fold back into the single line it started on. */
    canLeaveParameterRows:
      secretDefinitions.length === 0 && canCollapseRows(rows),
  };
}

/**
 * The overrides the run can carry, and the fields that collect them.
 *
 * The declared parameters are what the scenarios of the run declare plus
 * what the agents it goes against declare, so the line can offer an agent's
 * options. In a comparison the plain values ride on the rows of the targets,
 * so the block here holds the secrets alone and they are what the run sends
 * at run level.
 */
function useRunDialogParameters({
  subject,
  allScenarios,
  agents,
  targetAgentIds,
  fields,
  isCompare,
  areChoicesLoaded,
}: {
  subject: RunDialogSubject | null;
  allScenarios: readonly { id: string; parameters: unknown }[] | undefined;
  agents: readonly RunDialogAgent[];
  /** The ids of the agents the run goes against, sorted. */
  targetAgentIds: readonly string[];
  fields: RunDialogFields;
  isCompare: boolean;
  /** Whether the reads that hold the declarations have answered. */
  areChoicesLoaded: boolean;
}) {
  const { showParams, parameterLine, secretValues } = fields;

  const scenarioIds = useMemo(
    () => scenarioIdsOfSubject(subject, allScenarios ?? []),
    [subject, allScenarios],
  );

  const { parameterDefinitions, declaredParametersOf, secretDefinitions } =
    useDeclaredParameters({
      scenarioIds,
      allScenarios,
      agents,
      targetAgentIds,
    });

  // A declared secret cannot ride on the line, so the block that holds one
  // opens on its rows and stays there.
  const hasDeclaredSecrets = secretDefinitions.length > 0;
  const showParameterRows = fields.rowsRequested || hasDeclaredSecrets;

  // The line is what the block holds until a row is touched; after that the
  // rows are, and the line is written back from them.
  const parameterRows = useMemo(
    () => fields.parameterRows ?? rowsFromLine(parameterLine),
    [fields.parameterRows, parameterLine],
  );

  const { showParameters, hideParameters } = useParameterBlockToggle({
    fields,
    parameterDefinitions,
  });

  const rowActions = useParameterRowActions({ fields, rows: parameterRows });

  const secrets = useSecretParameterFields({
    fields,
    secretDefinitions,
    rows: parameterRows,
    showParameterRows,
    isCompare,
  });

  const values = resolveParameterValues({
    showParams: showParams || isCompare,
    showParameterRows: showParameterRows || isCompare,
    rows: isCompare ? parameterRows.filter((row) => row.secret) : parameterRows,
    line: parameterLine,
    secretValues,
    storesPlainValues: !isCompare,
    definitions: parameterDefinitions,
  });

  const parameterDefaults = useParameterDefaults(parameterDefinitions);

  const undeclaredError = useUndeclaredParameters({
    fields,
    definitions: parameterDefinitions,
    rows: parameterRows,
    showParameterRows,
    hasDeclaredSecrets,
    agents,
    isLoaded: areChoicesLoaded,
    isCompare,
  });

  return {
    parameterDefinitions,
    declaredParametersOf,
    parameterDefaults,
    secretDefinitions,
    parameterRows,
    showParameterRows,
    ...rowActions,
    showParameters,
    hideParameters,
    ...secrets,
    ...values,
    // A refusal the server named wins: it read the whole run, and this one is
    // only what the dialog can see of the same rule.
    parameterError: fields.parameterError ?? undeclaredError,
  };
}

/** The chip that opens the parameter block, and the x that takes it away. */
function useParameterBlockToggle({
  fields,
  parameterDefinitions,
}: {
  fields: RunDialogFields;
  parameterDefinitions: DeclaredParameter[];
}) {
  const { setShowParams, setParameterLine } = fields;
  const { setParameterRows, setRowsRequested, setSecretValues } = fields;

  /** Opens the overrides on the values the scenarios declare. */
  const showParameters = useCallback(() => {
    setParameterLine(formatParameterLine(parameterDefinitions));
    setParameterRows(null);
    setRowsRequested(false);
    setShowParams(true);
  }, [
    parameterDefinitions,
    setParameterLine,
    setParameterRows,
    setRowsRequested,
    setShowParams,
  ]);

  const hideParameters = useCallback(() => {
    setShowParams(false);
    setParameterLine("");
    setParameterRows(null);
    setRowsRequested(false);
    setSecretValues({});
  }, [
    setShowParams,
    setParameterLine,
    setParameterRows,
    setRowsRequested,
    setSecretValues,
  ]);

  return { showParameters, hideParameters };
}

/** Writing on the line, moving between the two modes, and editing the rows. */
function useParameterRowActions({
  fields,
  rows,
}: {
  fields: RunDialogFields;
  rows: ParameterRow[];
}) {
  const { setParameterLine, setParameterRows, setRowsRequested } = fields;
  const { setParameterError, setParameterLineTyped } = fields;

  /** Typing on the line makes the line what the rows are read from again. */
  const editParameterLine = useCallback(
    (line: string) => {
      setParameterLine(line);
      setParameterLineTyped(true);
      setParameterRows(null);
      setParameterError(null);
    },
    [
      setParameterLine,
      setParameterLineTyped,
      setParameterRows,
      setParameterError,
    ],
  );

  const setParameterRowsMode = useCallback(
    (wanted: boolean) => {
      if (wanted) {
        setParameterRows(rows);
        setRowsRequested(true);
        return;
      }
      setParameterLine(lineFromRows(rows));
      setParameterRows(null);
      setRowsRequested(false);
    },
    [rows, setParameterLine, setParameterRows, setRowsRequested],
  );

  const updateParameterRow = useCallback(
    (index: number, patch: Partial<ParameterRow>) => {
      setParameterRows(
        rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
      );
      setParameterError(null);
    },
    [rows, setParameterRows, setParameterError],
  );

  const addParameterRow = useCallback(() => {
    setParameterRows([...rows, { name: "", value: "", secret: false }]);
  }, [rows, setParameterRows]);

  /** A comparison shares its secrets, so the block there adds a secret row. */
  const addSecretParameterRow = useCallback(() => {
    setParameterRows([...rows, { name: "", value: "", secret: true }]);
  }, [rows, setParameterRows]);

  const removeParameterRow = useCallback(
    (index: number) => {
      setParameterRows(rows.filter((_, at) => at !== index));
    },
    [rows, setParameterRows],
  );

  return {
    editParameterLine,
    setParameterRowsMode,
    updateParameterRow,
    addParameterRow,
    addSecretParameterRow,
    removeParameterRow,
  };
}

/**
 * What the run carries, and the part of it the suite may remember.
 *
 * A secret value goes to the run alone. A secret row leaves its key behind, so
 * the next dialog shows the row again and asks for the value.
 */
function resolveParameterValues({
  showParams,
  showParameterRows,
  rows,
  line,
  secretValues,
  storesPlainValues,
  definitions,
}: {
  showParams: boolean;
  showParameterRows: boolean;
  rows: ParameterRow[];
  line: string;
  secretValues: Record<string, string>;
  /**
   * False in a comparison, where the plain values belong to the targets and
   * the block remembers nothing of its own.
   */
  storesPlainValues: boolean;
  /** The declarations in scope, for the type each value is read as. */
  definitions: readonly DeclaredParameter[];
}) {
  if (!showParams) {
    return {
      runParameters: undefined,
      storableRunParameters: undefined,
      storableSecretNames: undefined,
    };
  }

  if (!showParameterRows) {
    return {
      runParameters: toLineRunParameters({ line, secretValues, definitions }),
      storableRunParameters: toLineRunParameters({
        line,
        secretValues: {},
        definitions,
      }),
      storableSecretNames: undefined,
    };
  }

  return {
    runParameters: toRowsRunParameters({ rows, secretValues, definitions }),
    storableRunParameters: storesPlainValues
      ? toStorableRowParameters({ rows, definitions })
      : undefined,
    storableSecretNames: storableSecretRowNames(rows),
  };
}

/** Moving between the agent blocks, the prompt picker and the agent setup. */
function useRunDialogTargeting({
  fields,
  publishedPrompts,
}: {
  fields: RunDialogFields;
  publishedPrompts: PromptEntry[];
}) {
  const { target, setTarget, setMode, agentTargetBeforePrompt } = fields;
  const { openDrawer, setFlowCallbacks } = useDrawer();

  const selectPrompts = useCallback(() => {
    agentTargetBeforePrompt.current = target?.type === "prompt" ? null : target;
    setMode("prompts");
    const first = publishedPrompts[0];
    if (first) setTarget({ type: "prompt", id: first.id });
  }, [target, publishedPrompts, setMode, setTarget, agentTargetBeforePrompt]);

  const removePromptPicker = useCallback(() => {
    setMode("agents");
    setTarget(agentTargetBeforePrompt.current);
  }, [setMode, setTarget, agentTargetBeforePrompt]);

  const handleSetupAgent = useCallback(() => {
    const onAgentSaved = (agent: TypedAgent) => {
      const targetType = agent.type as NonNullable<TargetValue>["type"];
      setTarget({ type: targetType, id: agent.id });
    };
    setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
    setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
    setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
    openDrawer("agentTypeSelector");
  }, [openDrawer, setFlowCallbacks, setTarget]);

  return { selectPrompts, removePromptPicker, handleSetupAgent };
}

/**
 * The chips that add the optional parts of a run, in one fixed order.
 *
 * A chip is offered while the block it adds is closed, so the row shortens as
 * the run is customised and each block can be taken away again.
 */
function buildCustomizeRunChips({
  fields,
  planFields,
  hasParameterDefinitions,
  hasAgents,
  hasPublishedPrompts,
  onAddParameters,
  onCompareAgents,
  onRunAgainstPrompt,
}: {
  fields: RunDialogFields;
  planFields: RunPlanFields;
  hasParameterDefinitions: boolean;
  hasAgents: boolean;
  hasPublishedPrompts: boolean;
  onAddParameters: () => void;
  onCompareAgents: () => void;
  onRunAgainstPrompt: () => void;
}): CustomizeChip[] {
  const chips: CustomizeChip[] = [];
  // A comparison holds its parameters on its rows, so the block has no chip.
  if (
    !fields.showParams &&
    !planFields.showCompare &&
    hasParameterDefinitions
  ) {
    chips.push({
      key: "params",
      label: "Add parameters",
      onAdd: onAddParameters,
    });
  }
  if (!planFields.showCompare && fields.mode === "agents" && hasAgents) {
    chips.push({
      key: "compare",
      label: "Compare agents",
      onAdd: onCompareAgents,
    });
  }
  if (!fields.showNote) {
    chips.push({
      key: "note",
      label: "Add a note",
      onAdd: () => fields.setShowNote(true),
    });
  }
  if (fields.mode === "agents" && hasPublishedPrompts) {
    chips.push({
      key: "prompt",
      label: "Run against a prompt",
      onAdd: onRunAgainstPrompt,
    });
  }
  if (!planFields.showModels) {
    chips.push({
      key: "models",
      label: "Custom simulation models",
      onAdd: () => planFields.setShowModels(true),
    });
  }
  if (!planFields.showRepeat) {
    chips.push({
      key: "repeat",
      label: "Run multiple times",
      onAdd: () => planFields.setShowRepeat(true),
    });
  }
  return chips;
}

/**
 * How many scenarios a run of this subject covers, or nothing while the scenario
 * list a "run everything" subject needs is still on its way.
 */
function caseCountOf(
  subject: RunDialogSubject | null,
  allScenarios: readonly { id: string }[] | undefined,
  scopedIds: readonly string[],
): number | null {
  if (!subject) return null;
  if (subject.kind === "plan") return scopedIds.length;
  if (subject.kind === "case") return 1;
  if (subject.kind === "suite") return subject.scenarioIds.length;
  return allScenarios?.length ?? null;
}

/**
 * The targets the run goes against: the rows of a comparison, each with its
 * own overrides, or the one agent.
 *
 * A row's overrides are canonical: a value typed equal to the declared
 * default is left out, so what the dialog sends, sorts and names is the
 * target the server keys.
 */
function runTargetsOf({
  target,
  compareRows,
  defaults,
  definitions,
}: {
  target: TargetValue;
  compareRows: readonly CompareRow[];
  defaults: ParameterDefaults;
  definitions: readonly DeclaredParameter[];
}): RunTarget[] {
  if (compareRows.length > 0) {
    return compareRows.map((row) => {
      const runParameters = compareRowParameters({
        row,
        defaults,
        definitions,
      });
      return { ...row.target, ...(runParameters ? { runParameters } : {}) };
    });
  }
  return target ? [target] : [];
}

/**
 * The name of the run, and the configurations this scope already ran with.
 *
 * The scope is folded the way the server folds it before the history is read:
 * a scope naming every test suite of the project IS every scenario, and a
 * dialog that did not fold it would read the history of a scope its run never
 * lands in.
 */
function useRunDialogNaming({
  subject,
  subjectKey,
  choices,
  fields,
  planFields,
  runTargets,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
  choices: ReturnType<typeof useRunDialogChoices>;
  fields: RunDialogFields;
  planFields: RunPlanFields;
  runTargets: RunTarget[];
}) {
  const targetLabels = useMemo(
    () =>
      buildTargetLabels({
        agents: choices.scenarioAgents,
        prompts: choices.publishedPrompts,
      }),
    [choices.scenarioAgents, choices.publishedPrompts],
  );

  const runScope = useMemo(
    () =>
      normaliseRunScope({
        scope: planFields.scope,
        allTestSuiteIds: choices.testSuites.map((testSuite) => testSuite.id),
      }),
    [planFields.scope, choices.testSuites],
  );

  const history = useRunConfigurationHistory({
    scope: subject ? runScope : null,
    isEnabled: !!subject,
  });
  const historyEntries = history.entries;

  const name = useRunName({
    subjectKey,
    // A stored run plan opens on its own name; every other subject derives one.
    planName: subject?.kind === "suite" ? (subject.planName ?? null) : null,
    scopeLabel: subject
      ? scopeLabelOf({
          subject,
          scope: planFields.scope,
          testSuites: choices.testSuites,
          scenarios: choices.scopeScenarios,
        })
      : "",
    targets: runTargets,
    targetLabels,
    entries: historyEntries,
  });

  const applyConfiguration = useCallback(
    (key: string) => {
      const entry = historyEntries.find((candidate) => candidate.key === key);
      if (!entry) return;
      applyConfigurationTo({
        entry,
        fields,
        planFields,
        pinRunName: name.pinRunName,
      });
    },
    [historyEntries, fields, planFields, name.pinRunName],
  );

  useRunHistorySeed({
    subject,
    subjectKey,
    entries: historyEntries,
    isLoaded: history.isLoaded,
    fields,
    planFields,
  });

  return { name, runScope, applyConfiguration };
}

/**
 * What the dialog derives once its fields and its choices are known: the
 * targets the run goes against, its name, the scenarios in scope, and the
 * chips that add what is still folded away.
 */
function useDerivedRunDialogState({
  subject,
  subjectKey,
  choices,
  fields,
  planFields,
  parameters,
  targeting,
  comparing,
}: {
  subject: RunDialogSubject | null;
  subjectKey: string;
  choices: ReturnType<typeof useRunDialogChoices>;
  fields: RunDialogFields;
  planFields: RunPlanFields;
  parameters: ReturnType<typeof useRunDialogParameters>;
  targeting: ReturnType<typeof useRunDialogTargeting>;
  comparing: ReturnType<typeof useCompareRows>;
}) {
  const runTargets = runTargetsOf({
    target: fields.target,
    compareRows: planFields.compareRows,
    defaults: parameters.parameterDefaults,
    definitions: parameters.parameterDefinitions,
  });
  const naming = useRunDialogNaming({
    subject,
    subjectKey,
    choices,
    fields,
    planFields,
    runTargets,
  });

  const chips = buildCustomizeRunChips({
    fields,
    planFields,
    hasParameterDefinitions: parameters.parameterDefinitions.length > 0,
    hasAgents: choices.scenarioAgents.length > 0,
    hasPublishedPrompts: choices.publishedPrompts.length > 0,
    onAddParameters: parameters.showParameters,
    onCompareAgents: comparing.enterCompare,
    onRunAgainstPrompt: targeting.selectPrompts,
  });

  const scopedIds = scopedScenarioIds({
    subject,
    scope: planFields.scope,
    scenarios: choices.scopeScenarios,
    allScenarios: choices.allScenarios ?? [],
  });

  return {
    ...naming.name,
    applyConfiguration: naming.applyConfiguration,
    /** The scope the run goes out with, folded the way the server folds it. */
    runScope: naming.runScope,
    runTargets,
    scopedScenarioIds: scopedIds,
    chips,
    caseCount: caseCountOf(subject, choices.allScenarios, scopedIds),
  };
}

/** Everything an open run dialog holds and offers. */
export function useRunDialogForm(subject: RunDialogSubject | null) {
  const subjectKey = subjectKeyOf(subject);
  const choices = useRunDialogChoices(subject);
  const fields = useRunDialogFields(subject);
  const planFields = useRunPlanFields({ subject, subjectKey });
  const targetAgentIds = targetAgentIdsOf({
    target: fields.target,
    compareRows: planFields.compareRows,
  });
  const parameters = useRunDialogParameters({
    subject,
    allScenarios: choices.allScenarios,
    agents: choices.scenarioAgents,
    targetAgentIds,
    fields,
    isCompare: planFields.showCompare,
    areChoicesLoaded: choices.areChoicesLoaded,
  });
  const targeting = useRunDialogTargeting({
    fields,
    publishedPrompts: choices.publishedPrompts,
  });
  const comparing = useCompareRows({
    fields,
    planFields,
    agents: choices.scenarioAgents,
    defaults: parameters.parameterDefaults,
    definitions: parameters.parameterDefinitions,
  });

  const derived = useDerivedRunDialogState({
    subject,
    subjectKey,
    choices,
    fields,
    planFields,
    parameters,
    targeting,
    comparing,
  });

  return {
    ...fields,
    ...choices,
    ...parameters,
    ...targeting,
    ...comparing,
    ...planFields,
    ...derived,
  };
}

export type RunDialogForm = ReturnType<typeof useRunDialogForm>;
