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
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { useFilteredAgents } from "~/components/scenarios/useFilteredScenarioTargets";
import { unionParameterDefinitions } from "~/components/suites/useRunSuite";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";
import type { CustomizeRunChip } from "./CustomizeRunChips";
import type { PromptEntry } from "./PromptPicker";
import { formatParameterLine, toLineRunParameters } from "./parameter-line";
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

/** The fields of the dialog, reset whenever it opens on a new subject. */
function useRunDialogFields(subject: RunDialogSubject | null) {
  const [target, setTarget] = useState<TargetValue>(null);
  const [mode, setMode] = useState<RunDialogMode>("agents");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [parameterLine, setParameterLine] = useState("");
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [inlineError, setInlineError] = useState<unknown>(null);
  const [missingProvider, setMissingProvider] = useState(false);
  const agentTargetBeforePrompt = useRef<TargetValue>(null);

  const subjectKey = subjectKeyOf(subject);
  const initialTarget = subject?.initialTarget ?? null;
  useEffect(() => {
    setTarget(initialTarget);
    setMode(initialTarget?.type === "prompt" ? "prompts" : "agents");
    setShowNote(false);
    setNote("");
    setShowParams(false);
    setParameterLine("");
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

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId },
    { enabled: isDialogOpen },
  );
  const scenarioAgents = useFilteredAgents(agents, "");
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
  const { showParams, setShowParams, parameterLine, setParameterLine } = fields;
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
    () =>
      parameterDefinitions.filter((definition) => definition.secret === true),
    [parameterDefinitions],
  );

  /** Opens the overrides on the values the cases declare. */
  const showParameters = useCallback(() => {
    setParameterLine(formatParameterLine(parameterDefinitions));
    setShowParams(true);
  }, [parameterDefinitions, setParameterLine, setShowParams]);

  const hideParameters = useCallback(() => {
    setShowParams(false);
    setParameterLine("");
    setSecretValues({});
  }, [setShowParams, setParameterLine, setSecretValues]);

  const setSecretValue = useCallback(
    (name: string, value: string) => {
      setSecretValues((previous) => ({ ...previous, [name]: value }));
    },
    [setSecretValues],
  );

  const runParameters = showParams
    ? toLineRunParameters({ line: parameterLine, secretValues })
    : undefined;

  const hasMissingSecrets =
    showParams &&
    secretDefinitions.some(
      (definition) => (secretValues[definition.name] ?? "") === "",
    );

  return {
    parameterDefinitions,
    secretDefinitions,
    showParameters,
    hideParameters,
    setSecretValue,
    runParameters,
    hasMissingSecrets,
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
}): CustomizeRunChip[] {
  const chips: CustomizeRunChip[] = [];
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
