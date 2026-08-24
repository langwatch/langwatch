import {
  Box,
  Button,
  chakra,
  Grid,
  GridItem,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { generate } from "@langwatch/ksuid";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type FieldErrors,
  type UseFormReturn,
  useFormState,
  useWatch,
} from "react-hook-form";
import {
  applyHandledErrorToForm,
  FormServerError,
  HandledErrorState,
  showErrorToast,
} from "~/features/errors";
import type { Scenario } from "~/generated/prisma/client";
import { useRouter } from "~/utils/compat/next-router";
import {
  clearFlowCallbacks,
  getComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRunScenario } from "../../hooks/useRunScenario";
import { useScenarioTarget } from "../../hooks/useScenarioTarget";
import type { CustomComponentConfig } from "../../optimization_studio/types/dsl";
import type { TypedAgent } from "../../server/agents/agent.repository";
import { parseScenarioParameterDefinitions } from "../../server/scenarios/parameters";
import { api } from "../../utils/api";
import { KSUID_RESOURCES } from "../../utils/constants";
import { AgentTypeSelectorDrawer } from "../agents/AgentTypeSelectorDrawer";
import { PromptEditorDrawer } from "../prompts/PromptEditorDrawer";
import { hasScenarioInputMapping } from "../suites/ScenarioInputMappingSection";
import { Drawer } from "../ui/drawer";
import { TagList } from "../ui/TagList";
import { toaster } from "../ui/toaster";
import { SaveAndRunMenu } from "./SaveAndRunMenu";
import { ScenarioEditorSidebar } from "./ScenarioEditorSidebar";
import {
  type ScenarioFolderOption,
  ScenarioForm,
  type ScenarioFormData,
  type ScenarioInitialData,
} from "./ScenarioForm";
import { ScenarioParametersDialog } from "./ScenarioParametersDialog";
import { ScenarioRunModelDialog } from "./ScenarioRunModelDialog";
import type { TargetValue } from "./TargetSelector";

export type ScenarioFormDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (scenario: Scenario) => void;
  scenarioId?: string;
  /**
   * Which interface opened the editor. "agent-testing" adds the line under
   * the title, the test suite field and the plain Save button, and stays on
   * the page after a run starts. Absent keeps the editor as v1 draws it.
   */
  variant?: ScenarioEditorVariant;
  /** The suite a new case starts in, so a case made inside a suite lands in it. */
  folderId?: string | null;
  /**
   * Called instead of leaving for the v1 simulations page once a run starts.
   * Agent Testing stays where it is and opens the run in a drawer.
   */
  onRunStarted?: (params: { scenarioId: string; batchRunId: string }) => void;
} & Partial<ScenarioInitialData>;

export type ScenarioEditorVariant = "agent-testing";

/** What the Agent Testing editor says a test case is for. */
export const AGENT_TESTING_EDITOR_DESCRIPTION =
  "Test your agent on a critical path or edge case";

/**
 * Model overrides chosen in the run dialog. Omitted on a plain save so the
 * scenario's existing models are left untouched (undefined = no-op in the
 * Prisma update).
 */
type ModelOverrides = {
  simulatorModel: string | null;
  judgeModel: string | null;
};

/**
 * URL-based wrapper for ScenarioFormDrawer.
 * Reads scenarioId from drawer URL params and passes it as a prop.
 * Use this when rendering via the drawer registry / URL navigation.
 */
export function ScenarioFormDrawerFromUrl(
  props: Omit<ScenarioFormDrawerProps, "scenarioId">,
) {
  const params = useDrawerParams();
  const { drawerOpen } = useDrawer();
  // When rendered from the drawer registry (CurrentDrawer), no `open` prop is
  // passed.  Fall back to checking the URL so the drawer actually opens.
  const open = props.open ?? drawerOpen("scenarioEditor");
  return (
    <ScenarioFormDrawer
      {...props}
      open={open}
      scenarioId={params.scenarioId}
      folderId={props.folderId ?? params.folderId}
      variant={props.variant ?? (params.variant as ScenarioEditorVariant)}
    />
  );
}

/**
 * Drawer container for scenario create/edit form.
 * Two-column layout: form on left, help sidebar on right.
 * Bottom bar with Quick Test and Save and Run.
 *
 * When opened without a scenarioId (new scenario flow), the first save
 * creates the record and transitions to edit mode by updating the URL
 * with the new scenarioId. This prevents the double-save bug where
 * subsequent saves would create duplicates.
 */
export function ScenarioFormDrawer(props: ScenarioFormDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { closeDrawer, openDrawer } = useDrawer();
  const rawComplexProps = getComplexProps();
  const complexPropsData =
    rawComplexProps && "initialFormData" in rawComplexProps
      ? (rawComplexProps as Partial<ScenarioInitialData>)
      : {};
  const utils = api.useUtils();
  const [formInstance, setFormInstance] =
    useState<UseFormReturn<ScenarioFormData> | null>(null);
  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const scenarioId = props.scenarioId;
  const isAgentTesting = props.variant === "agent-testing";

  // Target selection with localStorage persistence
  const { target: persistedTarget, setTarget: persistTarget } =
    useScenarioTarget(scenarioId);
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(null);
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [agentTypeSelectorOpen, setAgentTypeSelectorOpen] = useState(false);
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);

  // Run-model dialog: after a target is picked in Save and Run, the user
  // confirms which user-simulator and judge models to run with. null = follow
  // the project default.
  const [runModelDialogOpen, setRunModelDialogOpen] = useState(false);
  const [pendingRunTarget, setPendingRunTarget] = useState<TargetValue>(null);
  const [runSimulatorModel, setRunSimulatorModel] = useState<string | null>(
    null,
  );
  const [runJudgeModel, setRunJudgeModel] = useState<string | null>(null);

  // Initialize from persisted target when scenario loads
  useEffect(() => {
    if (persistedTarget && !selectedTarget) {
      setSelectedTarget(persistedTarget);
    }
  }, [persistedTarget, selectedTarget]);

  // Update persistence when target changes
  const handleTargetChange = useCallback(
    (target: TargetValue) => {
      setSelectedTarget(target);
      if (target && scenarioId) {
        persistTarget(target);
      }
    },
    [persistTarget, scenarioId],
  );
  const handleCreateAgent = useCallback(() => {
    const onAgentSaved = (agent: TypedAgent) => {
      const targetType = agent.type as NonNullable<TargetValue>["type"];
      handleTargetChange({ type: targetType, id: agent.id });
      toaster.create({
        title: "Agent created",
        description: `"${agent.name}" is now selected as the target.`,
        type: "success",
      });
    };
    setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
    setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
    setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
    setAgentTypeSelectorOpen(true);
  }, [handleTargetChange]);

  const isOpen = props.open !== false && props.open !== undefined;
  const onClose = props.onClose ?? closeDrawer;
  const {
    data: scenario,
    isLoading: isScenarioLoading,
    isError: isScenarioReadFailed,
    error: scenarioReadError,
    refetch: refetchScenario,
  } = api.scenarios.getById.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project && !!scenarioId },
  );
  // Editing an existing scenario means the fields are empty until the query
  // answers. Without this the drawer renders a complete, blank form, which
  // reads as "the scenario has no name and no criteria" rather than "not
  // loaded yet", and the person who just asked an agent to write it cannot
  // tell the difference.
  //
  // The project is part of the wait. The read stays disabled until the project
  // resolves, and a disabled query does not report itself as loading, so
  // `isScenarioLoading` alone leaves that window uncovered and shows the blank
  // form it exists to prevent.
  const isHydrating = !!scenarioId && (!project || isScenarioLoading);
  // A read that fails ends the wait without producing a record, so the form
  // would come back with every field at its default. That is the blank form
  // the skeleton exists to prevent, and worse: the fields are editable, so
  // the person can fill in what looks like their scenario and save it.
  //
  // Only when there is no record to show. A background refetch that fails
  // keeps the record it read before, and the form the person is typing in
  // stays as it is rather than being replaced by an error with their edits
  // inside it.
  const hasReadFailed = !!scenarioId && isScenarioReadFailed && !scenario;
  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (data: Scenario) => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
      props.onSuccess?.(data);
    },
    onError: (error) => {
      if (
        formInstance &&
        applyHandledErrorToForm({
          error,
          form: formInstance,
          hasFormErrorSlot: true,
        })
      )
        return;
      showErrorToast({ error, fallbackTitle: "Couldn't create scenario" });
    },
  });
  const updateMutation = api.scenarios.update.useMutation({
    onSuccess: (data: Scenario) => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.scenarios.getById.invalidate({
        projectId: project?.id ?? "",
        id: data.id,
      });
      props.onSuccess?.(data);
    },
    onError: (error) => {
      if (
        formInstance &&
        applyHandledErrorToForm({
          error,
          form: formInstance,
          hasFormErrorSlot: true,
        })
      )
        return;
      showErrorToast({ error, fallbackTitle: "Couldn't save scenario" });
    },
  });

  /**
   * Transition from create mode to edit mode after first save.
   * Updates the URL with the new scenarioId so subsequent saves
   * trigger updates instead of creating duplicates.
   */
  const transitionToEditMode = useCallback(
    (newScenarioId: string) => {
      openDrawer(
        "scenarioEditor",
        {
          urlParams: { scenarioId: newScenarioId },
        },
        { resetStack: true },
      );
    },
    [openDrawer],
  );

  // Edit mode: the scenario already exists, so the save is a plain update.
  // Mutation errors are caught here so a save failure never surfaces as
  // "Failed to run scenario" in the save-and-run path — updateMutation's own
  // onError toast is what the user sees.
  const updateExisting = useCallback(
    async ({
      projectId,
      scenarioId,
      data,
      models,
    }: {
      projectId: string;
      scenarioId: string;
      data: ScenarioFormData;
      models?: ModelOverrides;
    }): Promise<Scenario | null> => {
      try {
        return await updateMutation.mutateAsync({
          projectId,
          id: scenarioId,
          ...data,
          ...(models ?? {}),
        });
      } catch {
        // Error toast already surfaced by updateMutation.onError; return null
        // so the save-and-run caller doesn't re-report it as a run failure.
        return null;
      }
    },
    [updateMutation],
  );

  const createScenario = useCallback(
    async ({
      projectId,
      data,
      skipTransition,
      models,
    }: {
      projectId: string;
      data: ScenarioFormData;
      skipTransition: boolean;
      models?: ModelOverrides;
    }): Promise<Scenario | null> => {
      try {
        const result = await createMutation.mutateAsync({
          projectId,
          ...data,
          ...(models ?? {}),
        });
        // Transition to edit mode to prevent double-create on subsequent saves.
        // Skip when the drawer is about to close (save-without-running).
        if (!skipTransition) {
          transitionToEditMode(result.id);
        }
        return result;
      } catch {
        // Error already handled by global mutation cache if license error
        return null;
      }
    },
    [createMutation, transitionToEditMode],
  );

  const handleSave = useCallback(
    async ({
      data,
      skipTransition = false,
      models,
    }: {
      data: ScenarioFormData;
      skipTransition?: boolean;
      models?: ModelOverrides;
    }): Promise<Scenario | null> => {
      const projectId = project?.id;
      if (!projectId) return null;

      // Branching on the loaded record alone made "we have not read it yet"
      // and "there is nothing to read" the same condition, so a save during
      // the read, or after one that failed, created a second scenario
      // instead of updating the one being edited. Being pointed at a scenario
      // is what decides this; the record only decides whether we can act yet.
      if (scenarioId) {
        if (!scenario) return null;
        return await updateExisting({
          projectId,
          scenarioId: scenario.id,
          data,
          models,
        });
      }

      return await createScenario({ projectId, data, skipTransition, models });
    },
    [project?.id, scenarioId, scenario, updateExisting, createScenario],
  );
  /**
   * Parameter rows are edited in their own dialog, and the message for a bad
   * row shows on the row. When parameter validation rejects a submit, open the
   * dialog again. The reader can then see which row is wrong.
   */
  const openParametersOnInvalid = useCallback(
    (errors: FieldErrors<ScenarioFormData>) => {
      if (errors.parameters) setParametersDialogOpen(true);
    },
    [],
  );
  const handleSaveAndRun = useCallback(
    async (target: TargetValue) => {
      const form = formInstance;
      if (!form || !project?.id || !project?.slug) return;
      if (!target) {
        toaster.create({
          title: "Select a target",
          description:
            "Please select a prompt or agent to run the scenario against.",
          type: "warning",
        });
        return;
      }

      // Gate: workflow agents require valid scenario mappings before running.
      if (target.type === "workflow") {
        try {
          const agent = await utils.agents.getById.fetch({
            id: target.id,
            projectId: project.id,
          });
          if (agent) {
            const config = agent.config as CustomComponentConfig;
            const mappings = config.scenarioMappings ?? {};
            // Run gate is input-only by design (#3412): a scenario needs only one
            // input ("input" or "messages") mapped to be runnable; output mapping
            // is optional (auto-populates to first output, or graceful stringify
            // fallback). Uses shared hasScenarioInputMapping SSOT so the run gate
            // and editor Save gate agree on the same input rule.
            if (!hasScenarioInputMapping(mappings)) {
              // Fallback affordance (#3411): even if the auto-open below races,
              // is dismissed, or fails, the toast itself links back to the editor.
              const openAgentEditor = () =>
                openDrawer("agentWorkflowEditor", {
                  urlParams: { agentId: target.id },
                });
              toaster.create({
                title: "Configure scenario mappings",
                description:
                  'Map at least one scenario input — "input" or "messages" — to an agent input before running this workflow agent.',
                type: "warning",
                action: {
                  label: "Open agent editor",
                  onClick: openAgentEditor,
                },
              });
              // Auto-open the editor now; the toast action above is the manual
              // fallback if this auto-open races, is dismissed, or fails.
              openAgentEditor();
              return;
            }
          }
        } catch {
          // If agent fetch fails, allow the run to proceed — server will validate.
        }
      }

      // Validate the scenario before asking for models so the dialog never
      // pops over an invalid form. Then pre-fill the run-model dialog from the
      // scenario's stored choices (null = follow the project default) and open
      // it — the actual save + run happens on confirm.
      const valid = await form.trigger();
      if (!valid) {
        openParametersOnInvalid(form.formState.errors);
        return;
      }

      setRunSimulatorModel(scenario?.simulatorModel ?? null);
      setRunJudgeModel(scenario?.judgeModel ?? null);
      setPendingRunTarget(target);
      setRunModelDialogOpen(true);
    },
    [
      project?.id,
      project?.slug,
      formInstance,
      utils,
      openDrawer,
      scenario,
      openParametersOnInvalid,
    ],
  );

  const onRunStarted = props.onRunStarted;
  const confirmRunWithModels = useCallback(async () => {
    const form = formInstance;
    const target = pendingRunTarget;
    if (!form || !target || !project?.id || !project?.slug) return;
    setRunModelDialogOpen(false);

    try {
      await form.handleSubmit(async (data) => {
        // skipTransition: don't open the edit-mode drawer mid-save — we're
        // navigating away to /simulations next, so the create→edit URL push
        // would race with our redirect (lw#3586 F11). The whole `await` is
        // also why the redirect itself MUST be the only router.push that
        // fires after — `onClose()` does its own router.push inside
        // closeDrawer, and back-to-back router.push calls get coalesced
        // (the cleanup push wins, the redirect gets dropped silently).
        const savedScenario = await handleSave({
          data,
          skipTransition: true,
          models: {
            simulatorModel: runSimulatorModel,
            judgeModel: runJudgeModel,
          },
        });
        if (!savedScenario) return;

        // Persist the target selection for this scenario
        persistTarget(target);

        // Generate batchRunId so the simulations page can show a placeholder immediately
        const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();

        // Fire the run — no callbacks, simulations page picks up via SSE
        void runScenario({ scenarioId: savedScenario.id, target, batchRunId });

        // Agent Testing stays on its page and opens the run in a drawer.
        if (onRunStarted) {
          onRunStarted({ scenarioId: savedScenario.id, batchRunId });
          return;
        }

        // Navigate to simulations — drawer closes implicitly via route change.
        // Intentionally NOT calling onClose() here: closeDrawer() does its
        // own router.push to strip drawer.* params, which would race with
        // this redirect and silently win (lw#3586 F11).
        void router.push(
          `/${project.slug}/simulations?pendingBatch=${batchRunId}`,
        );
      })();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't run scenario" });
    }
  }, [
    formInstance,
    pendingRunTarget,
    project?.id,
    project?.slug,
    handleSave,
    persistTarget,
    runScenario,
    router,
    runSimulatorModel,
    runJudgeModel,
    onRunStarted,
  ]);
  const handleSaveWithoutRunning = useCallback(async () => {
    const form = formInstance;
    if (!form) return;
    await form.handleSubmit(async (data) => {
      try {
        const saved = await handleSave({ data, skipTransition: true });
        if (saved) {
          toaster.create({
            title: scenario ? "Scenario updated" : "Scenario created",
            type: "success",
          });
          onClose();
        }
      } catch {
        // Error already handled by mutation onError callback
      }
    }, openParametersOnInvalid)();
  }, [handleSave, scenario, formInstance, onClose, openParametersOnInvalid]);
  const setFormRef = useCallback(
    (form: UseFormReturn<ScenarioFormData> | null) => {
      setFormInstance(form);
    },
    [],
  );
  const isSubmitting =
    createMutation.isPending || updateMutation.isPending || isRunning;

  // Use initial data from complexProps (new scenario from modal) or from DB (editing)
  const initialFormData =
    props.initialFormData ?? complexPropsData.initialFormData;
  const defaultValues: Partial<ScenarioFormData> | undefined = useMemo(() => {
    // A stored scenario carries its parameters as JSON, including the null a
    // scenario that never declared any has, so they are read through the
    // tolerant parser before the form sees them.
    if (scenario) {
      return {
        ...scenario,
        parameters: parseScenarioParameterDefinitions(scenario.parameters),
      };
    }
    // A new case made from inside a test suite starts filed in it.
    if (props.folderId !== undefined && props.folderId !== null) {
      return { ...(initialFormData ?? {}), folderId: props.folderId };
    }
    return initialFormData ?? undefined;
  }, [scenario, initialFormData, props.folderId]);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header borderBottomWidth="1px">
          {/* Being pointed at a scenario is enough to be editing one. Keying
              this off the loaded record alone retitled the drawer "Create
              Scenario" for the whole of the read. */}
          <VStack align="start" gap={1}>
            <Heading size="md">
              {scenarioId || scenario ? "Edit Scenario" : "Create Scenario"}
            </Heading>
            {isAgentTesting && (
              <Text fontSize="sm" color="fg.muted">
                {AGENT_TESTING_EDITOR_DESCRIPTION}
              </Text>
            )}
          </VStack>
        </Drawer.Header>
        <Drawer.Body padding={0} overflow="hidden">
          <Grid templateColumns="1fr 320px" height="full" overflow="hidden">
            {/* Left: Form */}
            <GridItem
              overflowY="auto"
              padding={6}
              borderRightWidth="1px"
              borderColor="border"
            >
              {hasReadFailed ? (
                <ScenarioReadError
                  error={scenarioReadError}
                  onRetry={() => void refetchScenario()}
                />
              ) : isHydrating ? (
                <ScenarioFormSkeleton />
              ) : (
                <>
                  {formInstance && <FormServerError form={formInstance} />}
                  {isAgentTesting ? (
                    <ScenarioFormWithSuites
                      key={scenarioId ?? "new"}
                      defaultValues={defaultValues}
                      formRef={setFormRef}
                    />
                  ) : (
                    <ScenarioForm
                      key={scenarioId ?? "new"}
                      defaultValues={defaultValues}
                      formRef={setFormRef}
                    />
                  )}
                </>
              )}
            </GridItem>
            {/* Right: Help Sidebar */}
            <GridItem overflowY="auto" padding={4} bg="bg.muted">
              <ScenarioEditorSidebar form={formInstance} />
            </GridItem>
          </Grid>
        </Drawer.Body>
        {/* Bottom Bar */}
        <Drawer.Footer borderTopWidth="1px" justifyContent="space-between">
          {formInstance && !isHydrating && !hasReadFailed && (
            <HStack gap={6} flex={1} overflow="hidden" flexWrap="wrap">
              <FooterLabels form={formInstance} />
              <FooterParameters
                form={formInstance}
                onOpen={() => setParametersDialogOpen(true)}
              />
            </HStack>
          )}
          <HStack gap={2} flexShrink={0}>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {/* There is nothing to save while the scenario is still being read,
                and nothing to save at all once the read has failed: the body
                is an error state, not a form. `handleSave` refuses either way,
                so this is what says so rather than what enforces it. */}
            {!hasReadFailed && isAgentTesting && (
              <Button
                variant="outline"
                size="sm"
                loading={isSubmitting}
                onClick={() => void handleSaveWithoutRunning()}
              >
                Save
              </Button>
            )}
            {!hasReadFailed && (
              <SaveAndRunMenu
                selectedTarget={selectedTarget}
                onTargetChange={handleTargetChange}
                onSaveAndRun={handleSaveAndRun}
                onSaveWithoutRunning={handleSaveWithoutRunning}
                onCreateAgent={handleCreateAgent}
                onCreatePrompt={() => setPromptDrawerOpen(true)}
                isLoading={isSubmitting || isHydrating}
              />
            )}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>

      {/* Parameter declarations: edited on the form, saved with the scenario.
          The form is gone while the scenario is being read and once the read
          has failed, so the dialog goes with it. */}
      {formInstance && !isHydrating && !hasReadFailed && (
        <ScenarioParametersDialog
          open={parametersDialogOpen}
          onOpenChange={setParametersDialogOpen}
          form={formInstance}
        />
      )}

      {/* Run-model dialog: choose user-simulator + judge models before running */}
      <ScenarioRunModelDialog
        open={runModelDialogOpen}
        onOpenChange={setRunModelDialogOpen}
        simulatorModel={runSimulatorModel}
        judgeModel={runJudgeModel}
        onSimulatorChange={setRunSimulatorModel}
        onJudgeChange={setRunJudgeModel}
        onConfirm={confirmRunWithModels}
        isRunning={isSubmitting}
      />

      {/* Agent Type Selector Drawer */}
      <AgentTypeSelectorDrawer
        open={agentTypeSelectorOpen}
        onClose={() => {
          setAgentTypeSelectorOpen(false);
          clearFlowCallbacks();
        }}
      />

      {/* Prompt Creation Drawer */}
      <PromptEditorDrawer
        open={promptDrawerOpen}
        onClose={() => setPromptDrawerOpen(false)}
        onSave={(prompt) => {
          // Auto-select the newly created prompt
          handleTargetChange({ type: "prompt", id: prompt.id });
          setPromptDrawerOpen(false);
          toaster.create({
            title: "Prompt created",
            description: `"${prompt.name}" is now selected as the target.`,
            type: "success",
          });
        }}
      />
    </Drawer.Root>
  );
}

/**
 * The form with the test suite field filled from the project.
 *
 * Only the Agent Testing editor reads the folder list, and it reads it here
 * rather than in the drawer, so every other surface never asks for it.
 */
function ScenarioFormWithSuites({
  defaultValues,
  formRef,
}: {
  defaultValues?: Partial<ScenarioFormData>;
  formRef: (form: UseFormReturn<ScenarioFormData> | null) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const folderOptions: ScenarioFolderOption[] = useMemo(
    () =>
      (folders ?? []).map((folder) => ({ id: folder.id, name: folder.name })),
    [folders],
  );

  return (
    <ScenarioForm
      defaultValues={defaultValues}
      formRef={formRef}
      folderOptions={folderOptions}
    />
  );
}

/**
 * Stands in for the form when the scenario could not be read.
 *
 * The alternative is the form at its defaults, which invites the person to
 * retype a scenario that already exists, and the save would have created a
 * second copy of it. Copy comes from the code-keyed registry like every other
 * error surface; the way forward is to read it again.
 */
function ScenarioReadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Box data-testid="scenario-read-error">
      <HandledErrorState
        error={error}
        fallbackTitle="Couldn't load this scenario"
        fullHeight={false}
      >
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </HandledErrorState>
    </Box>
  );
}

/**
 * Stands in for the form while an existing scenario is being read.
 *
 * Shaped like the form it replaces (name, situation, criteria) so the drawer
 * does not reflow when the real fields arrive.
 */
function ScenarioFormSkeleton() {
  return (
    <VStack align="stretch" gap={6} data-testid="scenario-form-skeleton">
      <VStack align="stretch" gap={3}>
        <Skeleton height="12px" width="48px" />
        <Skeleton height="40px" />
      </VStack>
      <VStack align="stretch" gap={3}>
        <Skeleton height="12px" width="72px" />
        <Skeleton height="32px" />
        <Skeleton height="120px" />
      </VStack>
      <VStack align="stretch" gap={3}>
        <Skeleton height="12px" width="60px" />
        <Skeleton height="32px" />
        <Skeleton height="96px" />
      </VStack>
    </VStack>
  );
}

function FooterLabels({ form }: { form: UseFormReturn<ScenarioFormData> }) {
  const labels = useWatch({ control: form.control, name: "labels" });

  return (
    <HStack gap={2} overflow="hidden" flexWrap="wrap">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" flexShrink={0}>
        Labels
      </Text>
      <TagList
        labels={labels}
        onRemove={(_label, index) =>
          form.setValue(
            "labels",
            labels.filter((_, i) => i !== index),
          )
        }
        onAdd={(label) => form.setValue("labels", [...labels, label])}
      />
    </HStack>
  );
}

/**
 * The declared parameter names, next to the labels, as the way into their
 * editor. Names are not removed here: a name can be read as "params.NAME" by
 * the situation, the criteria and the target, so removing one is a decision
 * taken in the editor with the rest of the declaration in view.
 */
function FooterParameters({
  form,
  onOpen,
}: {
  form: UseFormReturn<ScenarioFormData>;
  onOpen: () => void;
}) {
  const parameters = useWatch({ control: form.control, name: "parameters" });
  const { errors } = useFormState({ control: form.control });
  const invalid = !!errors.parameters;
  const declared = (parameters ?? []).filter(
    (definition) => definition.name.length > 0,
  );

  return (
    <HStack
      gap={2}
      overflow="hidden"
      flexWrap="wrap"
      data-testid="scenario-parameters-footer"
      data-invalid={invalid ? "true" : undefined}
    >
      <Text
        fontSize="xs"
        fontWeight="medium"
        color={invalid ? "fg.error" : "fg.muted"}
        flexShrink={0}
      >
        Parameters
      </Text>
      <HStack gap={1} flexWrap="wrap">
        {declared.map((definition, index) => (
          <ParameterChip
            key={`${definition.name}-${index}`}
            name={definition.name}
            isSecret={definition.secret === true}
            onOpen={onOpen}
          />
        ))}
        <Button
          type="button"
          size="xs"
          variant="outline"
          borderRadius="full"
          borderColor={invalid ? "fg.error" : "border"}
          color={invalid ? "fg.error" : undefined}
          onClick={onOpen}
          data-testid="edit-scenario-parameters"
        >
          + add
        </Button>
      </HStack>
    </HStack>
  );
}

const ChipButton = chakra("button");

function ParameterChip({
  name,
  isSecret,
  onOpen,
}: {
  name: string;
  isSecret: boolean;
  onOpen: () => void;
}) {
  return (
    <ChipButton
      type="button"
      onClick={onOpen}
      aria-label={
        isSecret ? `Edit secret parameter ${name}` : `Edit parameter ${name}`
      }
      data-testid={`scenario-parameter-chip-${name}`}
      bg="bg.muted"
      paddingX={2}
      paddingY={0.5}
      borderRadius="full"
      fontSize="xs"
      cursor="pointer"
      display="inline-flex"
      alignItems="center"
      gap={1}
      _hover={{ bg: "bg.emphasized" }}
    >
      {isSecret && <Lock size={10} />}
      {name}
    </ChipButton>
  );
}
