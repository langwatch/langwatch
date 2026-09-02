/**
 * The state of an open run dialog: the fields it holds, the targets it can
 * offer, the parameter overrides, and the chips that add them.
 *
 * The fields reset once per subject, so opening the dialog on another suite
 * or case starts from that subject's remembered target.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-notes.feature
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import { agentHasDevTunnel } from "@langwatch/agent-web/surfaces/browser-port";
import { type TargetValue, useFilteredAgents } from "../../scenarios/target-selector";
import { unionParameterDefinitions } from "../../suites/use-run-suite";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useAllPromptsForProject } from "../../../prompts/hooks/use-all-prompts-for-project";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import { api } from "../../../behavior/scenario-api";
import type { CustomizeChip } from "../shared/customize-chips";
import type { PromptEntry } from "./prompt-picker";
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
import type { RunDialogMode, RunDialogSubject } from "./run-dialog-types";

/** One key per subject the dialog can be open on, "closed" when it is not. */
function subjectKeyOf(subject: RunDialogSubject | null): string {
  if (!subject) return "closed";
  if (subject.kind === "all") return "all";
  if (subject.kind === "suite") return `suite:${subject.suiteId}`;
  return `case:${subject.scenarioId}`;
}

/** The cases a run of this subject covers. */
function scenarioIdsOfSubject(
  subject: RunDialogSubject | null,
  allScenarios: readonly { id: string }[],
): string[] {
  if (!subject) return [];
  if (subject.kind === "case") return [subject.scenarioId];
  if (subject.kind === "suite") return subject.scenarioIds;
  return allScenarios.map((scenario) => scenario.id);
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
function rememberedSecretRows(subject: RunDialogSubject | null): ParameterRow[] {
  if (subject?.kind !== "suite") return [];
  const names = subject.persistedTarget?.runSecretParameterNames ?? [];
  return names.map((name) => ({ name, value: "", secret: true }));
}

/** The fields of the dialog, reset whenever it opens on a new subject. */
function useRunDialogFields(subject: RunDialogSubject | null) {
  const [target, setTarget] = useState<TargetValue>(null);
  const [mode, setMode] = useState<RunDialogMode>("agents");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [parameterLine, setParameterLine] = useState("");
  // Null while the line is what the block holds: the rows are read off the
  // line until something is typed into one of them.
  const [parameterRows, setParameterRows] = useState<ParameterRow[] | null>(null);
  const [rowsRequested, setRowsRequested] = useState(false);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [inlineError, setInlineError] = useState<unknown>(null);
  const [missingProvider, setMissingProvider] = useState(false);
  const agentTargetBeforePrompt = useRef<TargetValue>(null);

  const subjectKey = subjectKeyOf(subject);
  const initialTarget = subject?.initialTarget ?? null;
  const initialParameterLine = rememberedParameterLine(subject);
  const initialSecretRows = rememberedSecretRows(subject);
  useEffect(() => {
    setTarget(initialTarget);
    setMode(initialTarget?.type === "prompt" ? "prompts" : "agents");
    // The note is the one field a run never remembers: it says what this run
    // is for, so it starts empty every time.
    setShowNote(false);
    setNote("");
    setShowParams(initialParameterLine !== "" || initialSecretRows.length > 0);
    setParameterLine(initialParameterLine);
    setRowsRequested(initialSecretRows.length > 0);
    setParameterRows(
      initialSecretRows.length > 0
        ? [...rowsFromLine(initialParameterLine), ...initialSecretRows]
        : null,
    );
    setSecretValues({});
    setInlineError(null);
    setMissingProvider(false);
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
    parameterLine,
    setParameterLine,
    parameterRows,
    setParameterRows,
    rowsRequested,
    setRowsRequested,
    secretValues,
    setSecretValues,
    inlineError,
    setInlineError,
    missingProvider,
    setMissingProvider,
    agentTargetBeforePrompt,
  };
}

type RunDialogFields = ReturnType<typeof useRunDialogFields>;

/** The agents, the published prompts and the cases the project holds. */
function useRunDialogChoices(subject: RunDialogSubject | null) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const isDialogOpen = !!project && !!subject;

  const { data: agents } = api.agents.getAll.useQuery({ projectId }, { enabled: isDialogOpen });
  // The picker takes a target agent, not the stored row: same projection the
  // other two target surfaces build, so all three offer the same agents.
  const targetAgents = useMemo(
    () =>
      agents?.map((agent) => ({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        updatedAt: agent.updatedAt,
        hasDevTunnel: agentHasDevTunnel(agent),
      })),
    [agents],
  );
  const scenarioAgents = useFilteredAgents(targetAgents, "");
  const { data: prompts } = useAllPromptsForProject();
  const { data: allScenarios } = api.scenarios.getAll.useQuery(
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

  return { scenarioAgents, publishedPrompts, allScenarios };
}

/** The overrides the run can carry, and the fields that collect them. */
function useRunDialogParameters({
  subject,
  allScenarios,
  fields,
}: {
  subject: RunDialogSubject | null;
  allScenarios: readonly { id: string; parameters: unknown }[] | undefined;
  fields: RunDialogFields;
}) {
  const { showParams, parameterLine } = fields;
  const { secretValues, setSecretValues } = fields;

  const parameterDefinitions = useMemo(
    () =>
      unionParameterDefinitions({
        scenarioIds: scenarioIdsOfSubject(subject, allScenarios ?? []),
        scenarios: allScenarios ?? [],
      }),
    [subject, allScenarios],
  );

  // The line a single input can carry, and the secrets that cannot ride on it.
  const secretDefinitions = useMemo(
    () => parameterDefinitions.filter((definition) => definition.secret === true),
    [parameterDefinitions],
  );

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

  const setSecretValue = useCallback(
    (name: string, value: string) => {
      setSecretValues((previous) => ({ ...previous, [name]: value }));
    },
    [setSecretValues],
  );

  const rowActions = useParameterRowActions({ fields, rows: parameterRows });

  /** Whether the block may fold back into the single line it started on. */
  const canLeaveParameterRows = !hasDeclaredSecrets && canCollapseRows(parameterRows);

  const values = resolveParameterValues({
    showParams,
    showParameterRows,
    rows: parameterRows,
    line: parameterLine,
    secretValues,
  });

  const hasMissingSecrets =
    showParams &&
    (secretDefinitions.some((definition) => (secretValues[definition.name] ?? "") === "") ||
      (showParameterRows && missingSecretRowNames(parameterRows).length > 0));

  return {
    parameterDefinitions,
    secretDefinitions,
    parameterRows,
    showParameterRows,
    canLeaveParameterRows,
    ...rowActions,
    showParameters,
    hideParameters,
    setSecretValue,
    ...values,
    hasMissingSecrets,
  };
}

/** The chip that opens the parameter block, and the x that takes it away. */
function useParameterBlockToggle({
  fields,
  parameterDefinitions,
}: {
  fields: RunDialogFields;
  parameterDefinitions: ScenarioParameterDefinition[];
}) {
  const { setShowParams, setParameterLine } = fields;
  const { setParameterRows, setRowsRequested, setSecretValues } = fields;

  /** Opens the overrides on the values the cases declare. */
  const showParameters = useCallback(() => {
    setParameterLine(formatParameterLine(parameterDefinitions));
    setParameterRows(null);
    setRowsRequested(false);
    setShowParams(true);
  }, [parameterDefinitions, setParameterLine, setParameterRows, setRowsRequested, setShowParams]);

  const hideParameters = useCallback(() => {
    setShowParams(false);
    setParameterLine("");
    setParameterRows(null);
    setRowsRequested(false);
    setSecretValues({});
  }, [setShowParams, setParameterLine, setParameterRows, setRowsRequested, setSecretValues]);

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

  /** Typing on the line makes the line what the rows are read from again. */
  const editParameterLine = useCallback(
    (line: string) => {
      setParameterLine(line);
      setParameterRows(null);
    },
    [setParameterLine, setParameterRows],
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
      setParameterRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
    },
    [rows, setParameterRows],
  );

  const addParameterRow = useCallback(() => {
    setParameterRows([...rows, { name: "", value: "", secret: false }]);
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
}: {
  showParams: boolean;
  showParameterRows: boolean;
  rows: ParameterRow[];
  line: string;
  secretValues: Record<string, string>;
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
      runParameters: toLineRunParameters({ line, secretValues }),
      storableRunParameters: toLineRunParameters({ line, secretValues: {} }),
      storableSecretNames: undefined,
    };
  }

  return {
    runParameters: toRowsRunParameters({ rows, secretValues }),
    storableRunParameters: toStorableRowParameters(rows),
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

/** The chips that add a note, parameter overrides, or a prompt target. */
function buildCustomizeRunChips({
  fields,
  hasParameterDefinitions,
  hasPublishedPrompts,
  onAddParameters,
  onRunAgainstPrompt,
}: {
  fields: RunDialogFields;
  hasParameterDefinitions: boolean;
  hasPublishedPrompts: boolean;
  onAddParameters: () => void;
  onRunAgainstPrompt: () => void;
}): CustomizeChip[] {
  const chips: CustomizeChip[] = [];
  if (!fields.showNote) {
    chips.push({
      key: "note",
      label: "Add a note to your run",
      onAdd: () => fields.setShowNote(true),
    });
  }
  if (!fields.showParams && hasParameterDefinitions) {
    chips.push({
      key: "params",
      label: "Override parameters",
      onAdd: onAddParameters,
    });
  }
  if (fields.mode === "agents" && hasPublishedPrompts) {
    chips.push({
      key: "prompt",
      label: "Run against a prompt",
      onAdd: onRunAgainstPrompt,
    });
  }
  return chips;
}

/**
 * How many test cases a run of this subject covers, or nothing while the case
 * list a "run everything" subject needs is still on its way.
 */
function caseCountOf(
  subject: RunDialogSubject | null,
  allScenarios: readonly { id: string }[] | undefined,
): number | null {
  if (!subject) return null;
  if (subject.kind === "case") return 1;
  if (subject.kind === "suite") return subject.scenarioIds.length;
  return allScenarios?.length ?? null;
}

/** Everything an open run dialog holds and offers. */
export function useRunDialogForm(subject: RunDialogSubject | null) {
  const choices = useRunDialogChoices(subject);
  const fields = useRunDialogFields(subject);
  const parameters = useRunDialogParameters({
    subject,
    allScenarios: choices.allScenarios,
    fields,
  });
  const targeting = useRunDialogTargeting({
    fields,
    publishedPrompts: choices.publishedPrompts,
  });
  const chips = buildCustomizeRunChips({
    fields,
    hasParameterDefinitions: parameters.parameterDefinitions.length > 0,
    hasPublishedPrompts: choices.publishedPrompts.length > 0,
    onAddParameters: parameters.showParameters,
    onRunAgainstPrompt: targeting.selectPrompts,
  });

  return {
    ...fields,
    ...choices,
    ...parameters,
    ...targeting,
    chips,
    caseCount: caseCountOf(subject, choices.allScenarios),
  };
}

export type RunDialogForm = ReturnType<typeof useRunDialogForm>;
