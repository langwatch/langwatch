import type { AgentWithFields as TypedAgent } from "@langwatch/agent-contract";
import {
  getComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/drawer";
import { applyHandledErrorToForm, showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
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
} from "@langwatch/design-system/primitives";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { toaster } from "@langwatch/design-system/toaster";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { scenarioClient } from "@langwatch/scenario-client";
import {
  parseCallerVoiceConfig,
  parseScenarioParameterDefinitions,
} from "@langwatch/scenario-contract";
import type { CustomComponentConfig } from "@langwatch/workflow-contract";
import { History, Lock, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Control, type FieldErrors, useFormState, useWatch } from "react-hook-form";

import { FormServerError, HandledErrorState } from "../../../behavior/errors.tsx";
import { api, type Scenario } from "../../../behavior/scenario-api.ts";
import { useScenario } from "../../../behavior/scenarios/use-scenario.ts";
import { useTestSuites } from "../../../behavior/suites/use-test-suites.ts";
import type { TargetValue } from "../../../model/scenario-target.ts";
import { CaseVersionChip } from "../../elements/agent-testing/shared/case-version-chip.tsx";
import {
  ScenarioForm,
  type ScenarioFormController,
  type ScenarioFormData,
  type ScenarioInitialData,
  type ScenarioTestSuiteOption,
} from "../../elements/scenario-form.tsx";
import { ScenarioParametersDialog } from "../../elements/scenarios/scenario-parameters-dialog.tsx";
import { hasScenarioInputMapping } from "../../elements/suites/scenario-input-mapping-section.tsx";
import { TagList } from "../../elements/tag-list.tsx";
import { useRunScenario } from "../use-run-scenario.ts";
import { useScenarioTarget } from "../use-scenario-target.ts";
import { CallerVoiceGroup } from "./caller-voice-group.tsx";
import { SaveAndRunMenu } from "./save-and-run-menu.tsx";
import { ScenarioEditorSidebar } from "./scenario-editor-sidebar.tsx";
import { ScenarioRunModelDialog } from "./scenario-run-model-dialog.tsx";

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
  /** The suite a new scenario starts in, so a scenario made inside a suite lands in it. */
  testSuiteId?: string | null;
  /**
   * Called instead of leaving for the v1 simulations page once a run starts.
   * Agent Testing stays where it is and opens the run in a drawer.
   */
  onRunStarted?: (params: { scenarioId: string; batchRunId: string }) => void;
} & Partial<ScenarioInitialData>;

export type ScenarioEditorVariant = "agent-testing";

/** What the Agent Testing editor says a scenario is for. */
export const AGENT_TESTING_EDITOR_DESCRIPTION = "Test your agent on a critical path or edge case";

/** Why Run is off on a scenario that has never run. */
export const NO_REMEMBERED_TARGET_HINT =
  "Run this scenario from the table first, to choose the agent it runs against.";

/**
 * Model overrides chosen in the run dialog. Omitted on a plain save so the
 * scenario's existing models are left untouched (undefined = no-op in the
 * Prisma update).
 */
type ModelOverrides = {
  simulatorModel: string | null;
  judgeModel: string | null;
};

/** What a save without a run confirms. Every surface calls the record a scenario. */
function savedToastTitle({ isUpdate }: { isUpdate: boolean }): string {
  return isUpdate ? "Scenario updated" : "Scenario created";
}

/**
 * URL-based wrapper for ScenarioFormDrawer.
 * Reads scenarioId from drawer URL params and passes it as a prop.
 * Use this when rendering via the drawer registry / URL navigation.
 */
export function ScenarioFormDrawerFromUrl(props: Omit<ScenarioFormDrawerProps, "scenarioId">) {
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
      testSuiteId={props.testSuiteId ?? params.testSuiteId}
      variant={props.variant ?? (params.variant as ScenarioEditorVariant)}
    />
  );
}

/**
 * Drawer container for scenario create/edit form. Two-column layout: form on left, help
 * sidebar on right. Bottom bar with Quick Test and Save and Run.
 */
export function ScenarioFormDrawer(props: ScenarioFormDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer, goBack } = useDrawer();
  const rawComplexProps = getComplexProps();
  const complexPropsData =
    rawComplexProps && "initialFormData" in rawComplexProps
      ? (rawComplexProps as Partial<ScenarioInitialData>)
      : {};
  const [formInstance, setFormInstance] = useState<ScenarioFormController | null>(null);
  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const scenarioId = props.scenarioId;
  const isAgentTesting = props.variant === "agent-testing";

  // A save that lost a race: somebody else stored a newer version while this
  // form held an older one. The editor offers the reload; nothing is written.
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  // Remounts the form after a stale reload so it reads the fresh record.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Target selection with localStorage persistence
  const { selectedTarget, handleTargetChange, persistTarget } = useSelectedTarget(scenarioId);
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);

  // Run-model dialog: after a target is picked in Save and Run, the user
  // confirms which user-simulator and judge models to run with. null = follow
  // the project default.

  // Initialize from persisted target when scenario loads
  const handleCreateAgent = useCreateAgentTarget({ handleTargetChange, openDrawer });
  const handleCreatePrompt = useCreatePromptTarget({ handleTargetChange, openDrawer, goBack });

  const isOpen = props.open !== false && props.open !== undefined;
  const onClose = props.onClose ?? closeDrawer;
  const {
    scenario,
    scenarioReadError,
    refetchScenario,
    isHydrating,
    hasReadFailed,
    showsFormSkeleton,
    showsFormFields,
  } = useScenarioRead({ projectId: project?.id, scenarioId });
  // The version this form is editing. A save sends it as the expected
  // version, so a save over somebody else's newer save is refused rather
  // than written.
  const loadedVersion = scenario?.version ?? null;
  const { handleSave, isSaving } = useScenarioSave({
    projectId: project?.id,
    scenarioId,
    scenario,
    isAgentTesting,
    loadedVersion,
    formInstance,
    onSuccess: props.onSuccess,
    openDrawer,
    setStaleVersion,
  });
  /**
   * Parameter rows are edited in their own dialog, and the message for a bad
   * row shows on the row. When parameter validation rejects a submit, open the
   * dialog again. The reader can then see which row is wrong.
   */
  const openParametersOnInvalid = useCallback((errors: FieldErrors<ScenarioFormData>) => {
    if (errors.parameters) setParametersDialogOpen(true);
  }, []);
  const {
    handleSaveAndRun,
    confirmRunWithModels,
    runModelDialogOpen,
    setRunModelDialogOpen,
    runSimulatorModel,
    setRunSimulatorModel,
    runJudgeModel,
    setRunJudgeModel,
  } = useScenarioRunFlow({
    formInstance,
    projectId: project?.id,
    projectSlug: project?.slug,
    scenario,
    openDrawer,
    openParametersOnInvalid,
    handleSave,
    persistTarget,
    runScenario,
    onRunStarted: props.onRunStarted,
  });
  const handleSaveWithoutRunning = useCallback(async () => {
    const form = formInstance;
    if (!form) return;
    await form.submit(async (data) => {
      try {
        const saved = await handleSave({ data, skipTransition: true });
        if (saved) {
          toaster.create({
            title: savedToastTitle({ isUpdate: !!scenario }),
            type: "success",
          });
          onClose();
        }
      } catch {
        // Error already handled by mutation onError callback
        return;
      }
    }, openParametersOnInvalid);
  }, [handleSave, scenario, formInstance, onClose, openParametersOnInvalid]);
  const setFormController = useCallback((controller: ScenarioFormController | null) => {
    setFormInstance(controller);
  }, []);
  const isSubmitting = isSaving || isRunning;

  // Use initial data from complexProps (new scenario from modal) or from DB (editing)
  const initialFormData = props.initialFormData ?? complexPropsData.initialFormData;
  const defaultValues = useMemo(
    () => defaultFormValuesOf({ scenario, initialFormData, testSuiteId: props.testSuiteId }),
    [scenario, initialFormData, props.testSuiteId],
  );

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()} size="xl">
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header borderBottomWidth="1px">
          {/* Being pointed at a scenario is enough to be editing one. Keying
              this off the loaded record alone retitled the drawer "Create
              Scenario" for the whole of the read. */}
          <ScenarioDrawerHeading
            isAgentTesting={isAgentTesting}
            isEditing={!!(scenarioId || scenario)}
            version={scenario?.version}
          />
        </Drawer.Header>
        <Drawer.Body padding={0} overflow="hidden">
          <Grid templateColumns="1fr 320px" height="full" overflow="hidden">
            {/* Left: Form */}
            <GridItem overflowY="auto" padding={6} borderRightWidth="1px" borderColor="border">
              {hasReadFailed && (
                <ScenarioReadError
                  error={scenarioReadError}
                  onRetry={() => void refetchScenario()}
                />
              )}
              {showsFormSkeleton && <ScenarioFormSkeleton />}
              {showsFormFields && (
                <ScenarioFormFields
                  formInstance={formInstance}
                  staleVersion={staleVersion}
                  onReloadStale={() => {
                    void (async () => {
                      await refetchScenario();
                      setStaleVersion(null);
                      setReloadNonce((nonce) => nonce + 1);
                    })();
                  }}
                  isAgentTesting={isAgentTesting}
                  formKey={`${scenarioId ?? "new"}-${reloadNonce}`}
                  defaultValues={defaultValues}
                  onControllerChange={setFormController}
                />
              )}
            </GridItem>
            {/* Right: Help Sidebar */}
            <GridItem overflowY="auto" padding={4} bg="bg.muted">
              <ScenarioEditorSidebar form={formInstance} variant={props.variant} />
            </GridItem>
          </Grid>
        </Drawer.Body>
        {/* Bottom Bar */}
        <Drawer.Footer borderTopWidth="1px" justifyContent="space-between">
          {formInstance && !isHydrating && !hasReadFailed && (
            <HStack gap={6} flex={1} overflow="hidden" flexWrap="wrap">
              <FooterLabels form={formInstance} />
              <FooterParameters form={formInstance} onOpen={() => setParametersDialogOpen(true)} />
            </HStack>
          )}
          <HStack gap={2} flexShrink={0}>
            {isAgentTesting && scenarioId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  openDrawer("scenarioVersionHistory", {
                    urlParams: { scenarioId },
                  })
                }
                data-testid="editor-history"
              >
                <History size={14} />
                History
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {/* There is nothing to save while the scenario is still being read,
                and nothing to save at all once the read has failed: the body
                is an error state, not a form. `handleSave` refuses either way,
                so this is what says so rather than what enforces it. */}
            {/* Agent Testing reads three plain buttons: Cancel, Save, Run.
                The Run button uses the agent this scenario last ran against,
                which the run dialog on the table remembers. */}
            {!hasReadFailed && isAgentTesting && (
              <AgentTestingActions
                isSubmitting={isSubmitting}
                hasTarget={!!selectedTarget}
                isHydrating={isHydrating}
                onSave={() => void handleSaveWithoutRunning()}
                onRun={() => void handleSaveAndRun(selectedTarget)}
              />
            )}
            {!hasReadFailed && !isAgentTesting && (
              <SaveAndRunMenu
                selectedTarget={selectedTarget}
                onTargetChange={handleTargetChange}
                onSaveAndRun={handleSaveAndRun}
                onSaveWithoutRunning={handleSaveWithoutRunning}
                onCreateAgent={handleCreateAgent}
                onCreatePrompt={handleCreatePrompt}
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
    </Drawer.Root>
  );
}

function renderCallerVoiceGroup(control: Control<ScenarioFormData>) {
  return <CallerVoiceGroup control={control} />;
}

/**
 * The form with the test suite field filled from the project.
 */
function ScenarioFormWithSuites({
  defaultValues,
  onControllerChange,
}: {
  defaultValues?: Partial<ScenarioFormData>;
  onControllerChange: (controller: ScenarioFormController | null) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { data: testSuites } = useTestSuites({ projectId: project?.id });
  const testSuiteOptions: ScenarioTestSuiteOption[] = useMemo(
    () =>
      (testSuites ?? []).map((testSuite) => ({
        id: testSuite.id,
        name: testSuite.name,
      })),
    [testSuites],
  );

  return (
    <ScenarioForm
      defaultValues={defaultValues}
      onControllerChange={onControllerChange}
      testSuiteOptions={testSuiteOptions}
      callerVoiceGroup={renderCallerVoiceGroup}
    />
  );
}

/**
 * Says the scenario changed since it was loaded, and offers the reload.
 * @see specs/scenarios/scenario-versioning.feature
 */
function StaleVersionNotice({
  currentVersion,
  onReload,
}: {
  currentVersion: number;
  onReload: () => void;
}) {
  return (
    <VStack
      align="start"
      gap={2}
      borderWidth="1px"
      borderColor="orange.solid"
      borderRadius="lg"
      padding={3}
      marginBottom={4}
      data-testid="scenario-stale-version"
    >
      <Text fontSize="sm" fontWeight="medium">
        This scenario changed since it was opened
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Somebody else saved {currentVersion > 0 ? `version ${currentVersion}` : "a newer version"}{" "}
        while this one was open. Nothing was written, so your edits are still here. Reloading
        replaces them with the newer version, so copy anything you want to keep first.
      </Text>
      <Button size="xs" variant="outline" onClick={onReload}>
        Discard my edits and reload
      </Button>
    </VStack>
  );
}

/**
 * Stands in for the form when the scenario could not be read.
 */
function ScenarioReadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
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

function FooterLabels({ form }: { form: ScenarioFormController }) {
  const labels = useWatch({ control: form.control, name: "labels" });

  return (
    <HStack gap={2} overflow="hidden" flexWrap="wrap">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" flexShrink={0}>
        Labels
      </Text>
      <TagList
        labels={labels}
        onRemove={(_label, index) =>
          form.update(
            "labels",
            labels.filter((_, i) => i !== index),
          )
        }
        onAdd={(label) => form.update("labels", [...labels, label])}
      />
    </HStack>
  );
}

/**
 * The declared parameter names, next to the labels, as the way into their editor.
 */
function FooterParameters({ form, onOpen }: { form: ScenarioFormController; onOpen: () => void }) {
  const parameters = useWatch({ control: form.control, name: "parameters" });
  const { errors } = useFormState({ control: form.control });
  const invalid = !!errors.parameters;
  const declared = (parameters ?? []).filter((definition) => definition.name.length > 0);

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
      aria-label={isSecret ? `Edit secret parameter ${name}` : `Edit parameter ${name}`}
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

type Dispatchers = ReturnType<typeof useDrawer>;
type TrpcUtils = ReturnType<typeof api.useUtils>;

/** Opens the agent type selector, selecting the agent the chosen editor saves. */
function useCreateAgentTarget({
  handleTargetChange,
  openDrawer,
}: {
  handleTargetChange: (target: TargetValue) => void;
  openDrawer: Dispatchers["openDrawer"];
}) {
  return useCallback(() => {
    const onAgentSaved = (agent: Pick<TypedAgent, "id" | "name" | "type">) => {
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
    /**
     * The agent type selector is OPENED BY ADDRESS, not mounted here.
     */
    openDrawer("agentTypeSelector");
  }, [handleTargetChange, openDrawer]);
}

/** Opens prompt's own editor by address; a saved prompt becomes the run target. */
function useCreatePromptTarget({
  handleTargetChange,
  openDrawer,
  goBack,
}: {
  handleTargetChange: (target: TargetValue) => void;
  openDrawer: Dispatchers["openDrawer"];
  goBack: Dispatchers["goBack"];
}) {
  return useCallback(() => {
    setFlowCallbacks("promptEditor", {
      onSave: (prompt: { id: string; name: string }) => {
        handleTargetChange({ type: "prompt", id: prompt.id });
        toaster.create({
          title: "Prompt created",
          description: `"${prompt.name}" is now selected as the target.`,
          type: "success",
        });
      },
    });
    openDrawer("promptEditor", { onClose: goBack });
  }, [handleTargetChange, openDrawer, goBack]);
}

/** Creates or updates the scenario, turning a stale edit into a reload prompt. */
function useScenarioSave({
  projectId,
  scenarioId,
  scenario,
  isAgentTesting,
  loadedVersion,
  formInstance,
  onSuccess,
  openDrawer,
  setStaleVersion,
}: {
  projectId: string | undefined;
  scenarioId: string | undefined;
  scenario: Scenario | undefined;
  isAgentTesting: boolean;
  loadedVersion: number | null;
  formInstance: ScenarioFormController | null;
  onSuccess: ScenarioFormDrawerProps["onSuccess"];
  openDrawer: Dispatchers["openDrawer"];
  setStaleVersion: (version: number | null) => void;
}) {
  const utils = scenarioClient.useUtils();

  const createMutation = scenarioClient.scenarios.create.useMutation({
    onSuccess: (data: Scenario) => {
      void utils.scenarios.getAll.invalidate({ projectId: projectId ?? "" });
      onSuccess?.(data);
    },
    onError: (error) =>
      rejectScenarioSave({ error, form: formInstance, fallbackTitle: "Couldn't create scenario" }),
  });
  const updateMutation = scenarioClient.scenarios.update.useMutation({
    onSuccess: (data: Scenario) => {
      void utils.scenarios.getAll.invalidate({ projectId: projectId ?? "" });
      // The saved record goes into the cache before the refetch, not after
      // it. `loadedVersion` reads from here, and a person who saves twice in
      // a row would otherwise send the version of the save before and be
      // refused for a conflict with their own write.
      utils.scenarios.getById.setData({ projectId: projectId ?? "", id: data.id }, data);
      void utils.scenarios.getById.invalidate({
        projectId: projectId ?? "",
        id: data.id,
      });
      onSuccess?.(data);
    },
    onError: (error) => {
      const handled = readHandledError(error);
      if (handled?.code === "scenario_stale_version") {
        const current = handled.meta.currentVersion;
        setStaleVersion(typeof current === "number" ? current : 0);
        return;
      }
      rejectScenarioSave({ error, form: formInstance, fallbackTitle: "Couldn't save scenario" });
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
          ...models,
          // Only the Agent Testing editor guards against a lost race; the
          // other write surfaces save over whatever is there, as they always
          // did.
          ...(isAgentTesting && loadedVersion !== null ? { expectedVersion: loadedVersion } : {}),
        });
      } catch {
        // Error toast already surfaced by updateMutation.onError; return null
        // so the save-and-run caller doesn't re-report it as a run failure.
        return null;
      }
    },
    [updateMutation, isAgentTesting, loadedVersion],
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
          ...models,
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
      if (!projectId) return null;

      // Branching on the loaded record alone made "we have not read it yet"
      // and "there is nothing to read" the same condition, so a save during
      // the read, or after one that failed, created a second scenario
      // instead of updating the one being edited. Being pointed at a scenario
      // is what decides this; the record only decides whether we can act yet.
      if (scenarioId) {
        if (!scenario) return null;
        return updateExisting({
          projectId,
          scenarioId: scenario.id,
          data,
          models,
        });
      }

      return createScenario({ projectId, data, skipTransition, models });
    },
    [projectId, scenarioId, scenario, updateExisting, createScenario],
  );

  return { handleSave, isSaving: createMutation.isPending || updateMutation.isPending };
}

/**
 * A workflow agent needs at least one scenario input mapped before it can run; when it has
 * none, points the author at the agent editor and says so.
 */
async function workflowLacksScenarioMapping({
  utils,
  agentId,
  projectId,
  openDrawer,
}: {
  utils: TrpcUtils;
  agentId: string;
  projectId: string;
  openDrawer: Dispatchers["openDrawer"];
}): Promise<boolean> {
  try {
    const agent = await utils.agents.getById.fetch({
      id: agentId,
      projectId,
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
            urlParams: { agentId },
          });
        toaster.create({
          title: "Configure scenario mappings",
          description:
            'Map at least one scenario input, "input" or "messages", to an agent input before running this workflow agent.',
          type: "warning",
          action: {
            label: "Open agent editor",
            onClick: openAgentEditor,
          },
        });
        // Auto-open the editor now; the toast action above is the manual
        // fallback if this auto-open races, is dismissed, or fails.
        openAgentEditor();
        return true;
      }
    }
    return false;
  } catch {
    // If agent fetch fails, allow the run to proceed — server will validate.
    return false;
  }
}

function defaultFormValuesOf({
  scenario,
  initialFormData,
  testSuiteId,
}: {
  scenario: Scenario | undefined;
  initialFormData: Partial<ScenarioFormData> | undefined;
  testSuiteId: string | null | undefined;
}): Partial<ScenarioFormData> | undefined {
  // A stored scenario carries its parameters as JSON, including the null a
  // scenario that never declared any has, so they are read through the
  // tolerant parser before the form sees them.
  if (scenario) {
    return {
      ...scenario,
      parameters: parseScenarioParameterDefinitions(scenario.parameters),
      // Stored as JSON (null on a scenario that never set one); read through
      // the tolerant parser so the form always has a full config to bind.
      callerVoice: parseCallerVoiceConfig((scenario as { callerVoice?: unknown }).callerVoice),
    };
  }
  // A new scenario made from inside a test suite starts filed in it.
  if (testSuiteId !== undefined && testSuiteId !== null) {
    return { ...initialFormData, testSuiteId: testSuiteId };
  }
  return initialFormData ?? undefined;
}

function ScenarioDrawerHeading({
  isAgentTesting,
  isEditing,
  version,
}: {
  isAgentTesting: boolean;
  isEditing: boolean;
  version: number | undefined;
}) {
  return (
    <VStack align="start" gap={1}>
      {isAgentTesting ? (
        <HStack gap={2}>
          <Heading size="md">{isEditing ? "Edit scenario" : "New scenario"}</Heading>
          <CaseVersionChip version={version} />
        </HStack>
      ) : (
        <Heading size="md">{isEditing ? "Edit Scenario" : "Create Scenario"}</Heading>
      )}
      {isAgentTesting && (
        <Text fontSize="sm" color="fg.muted">
          {AGENT_TESTING_EDITOR_DESCRIPTION}
        </Text>
      )}
    </VStack>
  );
}

/** Field errors land on the form when it has a slot for them; anything else toasts. */
function rejectScenarioSave({
  error,
  form,
  fallbackTitle,
}: {
  error: unknown;
  form: ScenarioFormController | null;
  fallbackTitle: string;
}): void {
  if (form && applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
  showErrorToast({ error, fallbackTitle });
}

/** Save and run: check the target, pick the run's models, then save, run and follow it. */
function useScenarioRunFlow({
  formInstance,
  projectId,
  projectSlug,
  scenario,
  openDrawer,
  openParametersOnInvalid,
  handleSave,
  persistTarget,
  runScenario,
  onRunStarted,
}: {
  formInstance: ScenarioFormController | null;
  projectId: string | undefined;
  projectSlug: string | undefined;
  scenario: Scenario | undefined;
  openDrawer: Dispatchers["openDrawer"];
  openParametersOnInvalid: (errors: FieldErrors<ScenarioFormData>) => void;
  handleSave: ReturnType<typeof useScenarioSave>["handleSave"];
  persistTarget: (target: NonNullable<TargetValue>) => void;
  runScenario: ReturnType<typeof useRunScenario>["runScenario"];
  onRunStarted: ScenarioFormDrawerProps["onRunStarted"];
}) {
  const utils = api.useUtils();
  const router = useRouter();
  const [runModelDialogOpen, setRunModelDialogOpen] = useState(false);
  const [pendingRunTarget, setPendingRunTarget] = useState<TargetValue>(null);
  const [runSimulatorModel, setRunSimulatorModel] = useState<string | null>(null);
  const [runJudgeModel, setRunJudgeModel] = useState<string | null>(null);

  const handleSaveAndRun = useCallback(
    async (target: TargetValue) => {
      const form = formInstance;
      if (!form || !projectId || !projectSlug) return;
      if (!target) {
        toaster.create({
          title: "Select a target",
          description: "Please select a prompt or agent to run the scenario against.",
          type: "warning",
        });
        return;
      }

      // Gate: workflow agents require valid scenario mappings before running.
      if (
        target.type === "workflow" &&
        (await workflowLacksScenarioMapping({
          utils,
          agentId: target.id,
          projectId: projectId,
          openDrawer,
        }))
      ) {
        return;
      }

      // Validate the scenario before asking for models so the dialog never
      // pops over an invalid form. Then pre-fill the run-model dialog from the
      // scenario's stored choices (null = follow the project default) and open
      // it — the actual save + run happens on confirm.
      const valid = await form.validate();
      if (!valid) {
        openParametersOnInvalid(form.errors());
        return;
      }

      setRunSimulatorModel(scenario?.simulatorModel ?? null);
      setRunJudgeModel(scenario?.judgeModel ?? null);
      setPendingRunTarget(target);
      setRunModelDialogOpen(true);
    },
    [projectId, projectSlug, formInstance, utils, openDrawer, scenario, openParametersOnInvalid],
  );

  const confirmRunWithModels = useCallback(async () => {
    const form = formInstance;
    const target = pendingRunTarget;
    if (!form || !target || !projectId || !projectSlug) return;
    setRunModelDialogOpen(false);

    try {
      await form.submit(async (data) => {
        // skipTransition: don't open the edit-mode drawer mid-save — we're navigating
        // away to /simulations next, so the create→edit URL push would race with our
        // redirect (lw#3586 F11).
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
        void router.push(`/${projectSlug}/simulations?pendingBatch=${batchRunId}`);
      });
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't run scenario" });
    }
  }, [
    formInstance,
    pendingRunTarget,
    projectId,
    projectSlug,
    handleSave,
    persistTarget,
    runScenario,
    router,
    runSimulatorModel,
    runJudgeModel,
    onRunStarted,
  ]);

  return {
    handleSaveAndRun,
    confirmRunWithModels,
    runModelDialogOpen,
    setRunModelDialogOpen,
    runSimulatorModel,
    setRunSimulatorModel,
    runJudgeModel,
    setRunJudgeModel,
  };
}

/** The form itself, under any server error and the stale-version notice. */
function ScenarioFormFields({
  formInstance,
  staleVersion,
  onReloadStale,
  isAgentTesting,
  formKey,
  defaultValues,
  onControllerChange,
}: {
  formInstance: ScenarioFormController | null;
  staleVersion: number | null;
  onReloadStale: () => void;
  isAgentTesting: boolean;
  formKey: string;
  defaultValues: Partial<ScenarioFormData> | undefined;
  onControllerChange: (controller: ScenarioFormController | null) => void;
}) {
  return (
    <>
      {formInstance && <FormServerError form={formInstance} />}
      {staleVersion !== null && (
        <StaleVersionNotice currentVersion={staleVersion} onReload={onReloadStale} />
      )}
      {/* Only the Agent Testing editor offers the test suite
          field, and only it pays for the folder query behind it. */}
      {isAgentTesting ? (
        <ScenarioFormWithSuites
          key={formKey}
          defaultValues={defaultValues}
          onControllerChange={onControllerChange}
        />
      ) : (
        <ScenarioForm
          key={formKey}
          defaultValues={defaultValues}
          onControllerChange={onControllerChange}
          callerVoiceGroup={renderCallerVoiceGroup}
        />
      )}
    </>
  );
}

/** Agent Testing's Save and Run, the run going to the agent the scenario last ran against. */
function AgentTestingActions({
  isSubmitting,
  hasTarget,
  isHydrating,
  onSave,
  onRun,
}: {
  isSubmitting: boolean;
  hasTarget: boolean;
  isHydrating: boolean;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <>
      <Button variant="outline" size="sm" loading={isSubmitting} onClick={onSave}>
        Save
      </Button>
      <Button
        colorPalette="blue"
        size="sm"
        loading={isSubmitting}
        disabled={!hasTarget || isHydrating}
        title={hasTarget ? undefined : NO_REMEMBERED_TARGET_HINT}
        onClick={onRun}
        data-testid="editor-run"
      >
        <Play size={14} />
        Run
      </Button>
    </>
  );
}

/** The run target: the one this scenario last ran against, until the author picks another. */
function useSelectedTarget(scenarioId: string | undefined) {
  const { target: persistedTarget, setTarget: persistTarget } = useScenarioTarget(scenarioId);
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(null);
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

  return { selectedTarget, handleTargetChange, persistTarget };
}

/** The scenario being edited, and which of skeleton, error or form the body shows. */
function useScenarioRead({
  projectId,
  scenarioId,
}: {
  projectId: string | undefined;
  scenarioId: string | undefined;
}) {
  const {
    data: scenario,
    isLoading: isScenarioLoading,
    isError: isScenarioReadFailed,
    error: scenarioReadError,
    refetch: refetchScenario,
  } = useScenario({ projectId, id: scenarioId });
  // Editing an existing scenario means the fields are empty until the query answers.
  const isHydrating = !!scenarioId && (!projectId || isScenarioLoading);
  // A read that fails ends the wait without producing a record, so the form would come
  // back with every field at its default.
  const hasReadFailed = !!scenarioId && isScenarioReadFailed && !scenario;
  const showsFormSkeleton = !hasReadFailed && isHydrating;
  const showsFormFields = !hasReadFailed && !isHydrating;

  return {
    scenario,
    scenarioReadError,
    refetchScenario,
    isHydrating,
    hasReadFailed,
    showsFormSkeleton,
    showsFormFields,
  };
}
