/**
 * The run dialog: one question, the agent to be tested, and chips that add a
 * note, parameter overrides, or a prompt in place of the agent.
 *
 * The target used last time is preselected, so a repeat run is one click. For
 * a test suite the confirmed target is written onto the suite row, so the next
 * run of that suite preselects it on any browser.
 *
 * A refusal the server can name (no target, everything archived, an unknown
 * parameter) reads inside the dialog and the dialog stays open. Only failures
 * with nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-notes.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { generate } from "@langwatch/ksuid";
import { Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { useFilteredAgents } from "~/components/scenarios/useFilteredScenarioTargets";
import { RunParameterFields } from "~/components/suites/RunParameterFields";
import {
  toRunParameters,
  unionParameterDefinitions,
} from "~/components/suites/useRunSuite";
import { Dialog } from "~/components/ui/dialog";
import {
  HandledErrorAlert,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { writeScenarioTarget } from "~/hooks/useScenarioTarget";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { KSUID_RESOURCES } from "~/utils/constants";
import { displayOptionalValue } from "~/utils/jsonValueText";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { type CustomizeRunChip, CustomizeRunChips } from "./CustomizeRunChips";
import { isNoteTooLong, RunNoteField } from "./RunNoteField";
import {
  AgentBlocks,
  PromptPicker,
  type RunDialogAgent,
  SetupAgentBox,
} from "./RunTargetPicker";

/** What the dialog is about to run. */
export type RunDialogSubject =
  | { kind: "all"; initialTarget: TargetValue }
  | {
      kind: "suite";
      suiteId: string;
      name: string;
      scenarioIds: string[];
      initialTarget: TargetValue;
    }
  | {
      kind: "case";
      scenarioId: string;
      name: string;
      initialTarget: TargetValue;
    };

/** What the caller learns the moment a run is queued. */
export type RunStartedInfo = {
  batchRunId: string;
  /** The run set the batch lands in, when it is known at queue time. */
  scenarioSetId?: string;
  /** Set on a one-off run: the case whose run to watch. */
  scenarioId?: string;
  /** Set on a one-off run: the agent it went against. */
  targetId?: string;
};

export type RunDialogProps = {
  subject: RunDialogSubject | null;
  onClose: () => void;
  onRunStarted: (info: RunStartedInfo) => void;
  /** A one-off run finished its start-up poll, well or not. */
  onCaseRunSettled?: (scenarioId: string) => void;
};

function subjectKeyOf(subject: RunDialogSubject | null): string {
  if (!subject) return "closed";
  if (subject.kind === "all") return "all";
  if (subject.kind === "suite") return `suite:${subject.suiteId}`;
  return `case:${subject.scenarioId}`;
}

function subjectTitle(subject: RunDialogSubject): string {
  return subject.kind === "all" ? "All test cases" : subject.name;
}

export function RunDialog({
  subject,
  onClose,
  onRunStarted,
  onCaseRunSettled,
}: RunDialogProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId },
    { enabled: !!project && !!subject },
  );
  const scenarioAgents = useFilteredAgents(agents, "");
  const { data: prompts } = useAllPromptsForProject();
  const { data: allScenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: !!project && !!subject },
  );

  const publishedPrompts = useMemo(
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

  // --- Form state, reset whenever the dialog opens on a new subject --------

  const [target, setTarget] = useState<TargetValue>(null);
  const [mode, setMode] = useState<"agents" | "prompts">("agents");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [parameterOverrides, setParameterOverrides] = useState<
    Record<string, string>
  >({});
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
    setParameterOverrides({});
    setInlineError(null);
    setMissingProvider(false);
    agentTargetBeforePrompt.current = null;
    // Reset exactly once per subject; the target of a subject does not move
    // under an open dialog.
  }, [subjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- The parameters the run can carry ------------------------------------

  const scenarioIdsInRun = useMemo(() => {
    if (!subject) return [];
    if (subject.kind === "case") return [subject.scenarioId];
    if (subject.kind === "suite") return subject.scenarioIds;
    return (allScenarios ?? []).map((scenario) => scenario.id);
  }, [subject, allScenarios]);

  const parameterDefinitions = useMemo(
    () =>
      unionParameterDefinitions({
        scenarioIds: scenarioIdsInRun,
        scenarios: allScenarios ?? [],
      }),
    [scenarioIdsInRun, allScenarios],
  );

  const parameterValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const definition of parameterDefinitions) {
      values[definition.name] =
        parameterOverrides[definition.name] ??
        displayOptionalValue(definition.defaultValue);
    }
    return values;
  }, [parameterDefinitions, parameterOverrides]);

  const runParameters = showParams
    ? toRunParameters({
        definitions: parameterDefinitions,
        values: parameterValues,
      })
    : undefined;

  const missingSecrets =
    showParams &&
    parameterDefinitions.some(
      (definition) =>
        definition.secret === true &&
        (parameterValues[definition.name] ?? "") === "",
    );

  // --- Target choices -------------------------------------------------------

  const selectPrompts = useCallback(() => {
    agentTargetBeforePrompt.current = target?.type === "prompt" ? null : target;
    setMode("prompts");
    const first = publishedPrompts[0];
    if (first) setTarget({ type: "prompt", id: first.id });
  }, [target, publishedPrompts]);

  const removePromptPicker = useCallback(() => {
    setMode("agents");
    setTarget(agentTargetBeforePrompt.current);
  }, []);

  const { openDrawer, setFlowCallbacks } = useDrawer();
  const handleSetupAgent = useCallback(() => {
    const onAgentSaved = (agent: TypedAgent) => {
      const targetType = agent.type as NonNullable<TargetValue>["type"];
      setTarget({ type: targetType, id: agent.id });
    };
    setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
    setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
    setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
    openDrawer("agentTypeSelector");
  }, [openDrawer, setFlowCallbacks]);

  const chips: CustomizeRunChip[] = [];
  if (!showNote) {
    chips.push({
      key: "note",
      label: "Add a note to your run",
      onAdd: () => setShowNote(true),
    });
  }
  if (!showParams && parameterDefinitions.length > 0) {
    chips.push({
      key: "params",
      label: "Override parameters",
      onAdd: () => setShowParams(true),
    });
  }
  if (mode === "agents" && publishedPrompts.length > 0) {
    chips.push({
      key: "prompt",
      label: "Run against a prompt",
      onAdd: selectPrompts,
    });
  }

  const controller = useRunDialogSubmit({
    subject,
    target,
    note,
    runParameters,
    onRunStarted,
    onCaseRunSettled,
    onClose,
    setInlineError,
    setMissingProvider,
  });

  const noteTooLong = isNoteTooLong(note);
  const runDisabled =
    controller.isBusy ||
    noteTooLong ||
    missingSecrets ||
    // A one-off run has no server-side refusal to lean on, and a project with
    // nothing to test has nothing to choose: Run waits for a target.
    (!target && (subject?.kind === "case" || !controller.hasAnyTarget));

  if (!subject) return null;

  return (
    <Dialog.Root
      open={!!subject}
      onOpenChange={({ open }) => {
        if (!open && !controller.isBusy) onClose();
      }}
      placement="center"
    >
      <Dialog.Content
        bg="bg"
        maxWidth="600px"
        onClick={(event) => event.stopPropagation()}
        data-testid={subject.kind === "case" ? "run-case-dialog" : "run-dialog"}
      >
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Run · {subjectTitle(subject)}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <TargetSection
              mode={mode}
              agents={scenarioAgents}
              prompts={publishedPrompts}
              target={target}
              onSelect={setTarget}
              onRemovePromptPicker={removePromptPicker}
              onSetupAgent={handleSetupAgent}
            />

            {showNote && (
              <RunNoteField
                value={note}
                onChange={setNote}
                onRemove={() => {
                  setShowNote(false);
                  setNote("");
                }}
              />
            )}

            {showParams && (
              <VStack
                align="stretch"
                gap={0}
                data-testid="run-dialog-parameters"
              >
                <HStack justify="flex-end">
                  <Button
                    size="2xs"
                    variant="ghost"
                    color="fg.muted"
                    aria-label="Remove the parameter overrides"
                    onClick={() => {
                      setShowParams(false);
                      setParameterOverrides({});
                    }}
                  >
                    <X size={12} />
                  </Button>
                </HStack>
                <RunParameterFields
                  parameters={parameterDefinitions}
                  values={parameterValues}
                  onChange={(name, value) =>
                    setParameterOverrides((previous) => ({
                      ...previous,
                      [name]: value,
                    }))
                  }
                  disabled={controller.isBusy}
                />
              </VStack>
            )}

            <CustomizeRunChips chips={chips} />

            {missingProvider && <MissingProviderNotice />}

            {inlineError != null && (
              <Box data-testid="run-dialog-error">
                <HandledErrorAlert
                  error={inlineError}
                  fallbackTitle="Couldn't start the run"
                />
              </Box>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            size="sm"
            disabled={controller.isBusy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!target || controller.isBusy}
            loading={controller.isSaving}
            onClick={() => void controller.save()}
          >
            Save
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            disabled={runDisabled}
            loading={controller.isRunning}
            onClick={() => void controller.run()}
            data-testid="run-dialog-run"
          >
            <Play size={14} />
            Run
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The agent blocks, the prompt picker, or the setup box. */
function TargetSection({
  mode,
  agents,
  prompts,
  target,
  onSelect,
  onRemovePromptPicker,
  onSetupAgent,
}: {
  mode: "agents" | "prompts";
  agents: RunDialogAgent[];
  prompts: { id: string; handle: string | null; version: number }[];
  target: TargetValue;
  onSelect: (target: NonNullable<TargetValue>) => void;
  onRemovePromptPicker: () => void;
  onSetupAgent: () => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          {mode === "prompts" ? "Prompt to be tested" : "Agent to be tested"}
        </Text>
        {mode === "prompts" && (
          <Button
            size="2xs"
            variant="ghost"
            color="fg.muted"
            aria-label="Remove the prompt picker"
            onClick={onRemovePromptPicker}
          >
            <X size={12} />
          </Button>
        )}
      </HStack>
      {mode === "prompts" ? (
        <PromptPicker prompts={prompts} selected={target} onSelect={onSelect} />
      ) : agents.length > 0 ? (
        <AgentBlocks agents={agents} selected={target} onSelect={onSelect} />
      ) : (
        <SetupAgentBox onSetup={onSetupAgent} />
      )}
    </VStack>
  );
}

/** What a project without a model provider reads instead of a queued run. */
function MissingProviderNotice() {
  return (
    <VStack
      align="start"
      gap={2}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      padding={3}
      data-testid="run-dialog-missing-provider"
    >
      <Text fontSize="sm" fontWeight="medium">
        No model provider is set up
      </Text>
      <Text fontSize="xs" color="fg.muted">
        A run needs a model provider to simulate the user and judge the result.
      </Text>
      <Button
        size="xs"
        variant="outline"
        onClick={() =>
          window.open(
            "/settings/model-providers",
            "_blank",
            "noopener,noreferrer",
          )
        }
      >
        Open model provider settings
      </Button>
    </VStack>
  );
}

/**
 * The writes of the dialog: persist the target, then start the run through
 * the path the subject uses.
 */
function useRunDialogSubmit({
  subject,
  target,
  note,
  runParameters,
  onRunStarted,
  onCaseRunSettled,
  onClose,
  setInlineError,
  setMissingProvider,
}: {
  subject: RunDialogSubject | null;
  target: TargetValue;
  note: string;
  runParameters: ReturnType<typeof toRunParameters>;
  onRunStarted: (info: RunStartedInfo) => void;
  onCaseRunSettled?: (scenarioId: string) => void;
  onClose: () => void;
  setInlineError: (error: unknown) => void;
  setMissingProvider: (missing: boolean) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();
  const setLastRunTarget = useAgentTestingStore(
    (state) => state.setLastRunTarget,
  );

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId },
    { enabled: !!project && !!subject },
  );
  const { data: prompts } = useAllPromptsForProject();
  const hasAnyTarget =
    (agents ?? []).length > 0 ||
    (prompts ?? []).some((prompt) => prompt.version > 0);

  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId: projectId || undefined,
  });

  const updateSuite = api.suites.update.useMutation();
  const runSuite = api.suites.run.useMutation();
  const runAll = api.suites.runAll.useMutation();

  const scenarioId = subject?.kind === "case" ? subject.scenarioId : null;
  const { runScenario, isRunning: isCaseRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
    onQueued: () => undefined,
    onRunComplete: () => {
      if (scenarioId) onCaseRunSettled?.(scenarioId);
    },
    onRunFailed: () => {
      if (scenarioId) onCaseRunSettled?.(scenarioId);
    },
  });

  const trimmedNote = note.trim();
  const noteInput = trimmedNote.length > 0 ? trimmedNote : undefined;
  const suiteTargets = target
    ? [{ type: target.type, referenceId: target.id }]
    : undefined;

  /** Shows a coded refusal inside the dialog; anything else becomes a toast. */
  const surfaceError = useCallback(
    (error: unknown) => {
      if (readHandledError(error)) {
        setInlineError(error);
        return;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't start the run" });
    },
    [setInlineError],
  );

  const persistTargetChoice = useCallback(async () => {
    if (!subject || !target) return;
    setLastRunTarget(target);
    if (subject.kind === "case") {
      writeScenarioTarget({
        projectId,
        scenarioId: subject.scenarioId,
        target,
      });
      return;
    }
    if (subject.kind === "suite" && suiteTargets) {
      await updateSuite.mutateAsync({
        projectId,
        id: subject.suiteId,
        targets: suiteTargets,
      });
      // The rail's folder list carries the persisted targets; the next open
      // of this dialog preselects from it.
      void utils.suites.folders.getAll.invalidate({ projectId });
    }
    // Run all persists its targets through the run itself: the managed suite
    // may not exist before the first run.
  }, [
    subject,
    target,
    projectId,
    suiteTargets,
    updateSuite,
    utils,
    setLastRunTarget,
  ]);

  const save = useCallback(async () => {
    setInlineError(null);
    try {
      await persistTargetChoice();
      onClose();
    } catch (error) {
      surfaceError(error);
    }
  }, [persistTargetChoice, onClose, setInlineError, surfaceError]);

  const runCase = useCallback(
    (subjectCase: Extract<RunDialogSubject, { kind: "case" }>) => {
      if (!target) return;
      if (!hasEnabledProviders) {
        setMissingProvider(true);
        return;
      }
      writeScenarioTarget({
        projectId,
        scenarioId: subjectCase.scenarioId,
        target,
      });
      setLastRunTarget(target);
      const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
      void runScenario({
        scenarioId: subjectCase.scenarioId,
        target,
        batchRunId,
        note: noteInput,
        parameters: runParameters,
      });
      onRunStarted({
        batchRunId,
        scenarioSetId: getOnPlatformSetId(projectId),
        scenarioId: subjectCase.scenarioId,
        targetId: target.id,
      });
      onClose();
    },
    [
      target,
      hasEnabledProviders,
      projectId,
      runScenario,
      noteInput,
      runParameters,
      onRunStarted,
      onClose,
      setLastRunTarget,
      setMissingProvider,
    ],
  );

  const run = useCallback(async () => {
    if (!subject || !projectId) return;
    setInlineError(null);
    setMissingProvider(false);

    if (subject.kind === "case") {
      runCase(subject);
      return;
    }

    const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
    try {
      if (subject.kind === "suite") {
        await persistTargetChoice();
        const result = await runSuite.mutateAsync({
          projectId,
          id: subject.suiteId,
          idempotencyKey: crypto.randomUUID(),
          batchRunId,
          note: noteInput,
          parameters: runParameters,
        });
        onRunStarted({
          batchRunId: result.batchRunId ?? batchRunId,
          scenarioSetId: getSuiteSetId(subject.suiteId),
        });
      } else {
        if (target) setLastRunTarget(target);
        const result = await runAll.mutateAsync({
          projectId,
          idempotencyKey: crypto.randomUUID(),
          batchRunId,
          targets: suiteTargets,
          note: noteInput,
          parameters: runParameters,
        });
        onRunStarted({ batchRunId: result.batchRunId ?? batchRunId });
      }
      onClose();
    } catch (error) {
      surfaceError(error);
    }
  }, [
    subject,
    projectId,
    target,
    suiteTargets,
    noteInput,
    runParameters,
    runCase,
    persistTargetChoice,
    runSuite,
    runAll,
    onRunStarted,
    onClose,
    setInlineError,
    setMissingProvider,
    setLastRunTarget,
    surfaceError,
  ]);

  const isRunning = runSuite.isPending || runAll.isPending || isCaseRunning;
  const isSaving = updateSuite.isPending;

  return {
    save,
    run,
    hasAnyTarget,
    isSaving,
    isRunning,
    isBusy: isSaving || runSuite.isPending || runAll.isPending,
  };
}
