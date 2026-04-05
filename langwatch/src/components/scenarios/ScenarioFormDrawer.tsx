import { Button, Grid, GridItem, Heading, HStack, Text } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KSUID_RESOURCES } from "../../utils/constants";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { getComplexProps, setFlowCallbacks, useDrawer, useDrawerParams } from "../../hooks/useDrawer";
import { useDrawerRunCallbacks } from "../../hooks/useDrawerRunCallbacks";
import { AgentTypeSelectorDrawer } from "../agents/AgentTypeSelectorDrawer";
import { checkCompoundLimits } from "../../hooks/useCompoundLicenseCheck";
import { useLicenseEnforcement } from "../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRunScenario } from "../../hooks/useRunScenario";
import { useScenarioTarget } from "../../hooks/useScenarioTarget";
import { api } from "../../utils/api";
import { isHandledByGlobalHandler } from "../../utils/trpcError";
import type { TypedAgent } from "../../server/agents/agent.repository";
import { PromptEditorDrawer } from "../prompts/PromptEditorDrawer";
import { TagList } from "../ui/TagList";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { SaveAndRunMenu } from "./SaveAndRunMenu";
import { ScenarioEditorSidebar } from "./ScenarioEditorSidebar";
import { ScenarioForm, type ScenarioFormData, type ScenarioInitialData } from "./ScenarioForm";
import type { TargetValue } from "./TargetSelector";

export type ScenarioFormDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (scenario: Scenario) => void;
  scenarioId?: string;
} & Partial<ScenarioInitialData>;

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
  return <ScenarioFormDrawer {...props} open={open} scenarioId={params.scenarioId} />;
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
  const utils = api.useContext();
  const [formInstance, setFormInstance] =
    useState<UseFormReturn<ScenarioFormData> | null>(null);
  const { onRunComplete, onRunFailed } = useDrawerRunCallbacks();

  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
    onRunComplete,
    onRunFailed,
  });
  const scenarioId = props.scenarioId;

  // License enforcement for scenario creation
  const scenarioEnforcement = useLicenseEnforcement("scenarios");

  // Target selection with localStorage persistence
  const { target: persistedTarget, setTarget: persistTarget } =
    useScenarioTarget(scenarioId);
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(null);
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [agentTypeSelectorOpen, setAgentTypeSelectorOpen] = useState(false);

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
        meta: { closable: true },
      });
    };
    setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
    setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
    setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
    setAgentTypeSelectorOpen(true);
  }, [handleTargetChange]);

  const isOpen = props.open !== false && props.open !== undefined;
  const onClose = props.onClose ?? closeDrawer;
  const { data: scenario } = api.scenarios.getById.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project && !!scenarioId },
  );
  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (data: Scenario) => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
      props.onSuccess?.(data);
    },
    onError: (error) => {
      // Skip toast if already handled by global license handler (shows modal instead)
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Failed to create scenario",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
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
      // Skip toast if already handled by global license handler (shows modal instead)
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Failed to update scenario",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
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
        { resetStack: true }
      );
    },
    [openDrawer],
  );

  const handleSave = useCallback(
    async (data: ScenarioFormData, { skipTransition = false } = {}): Promise<Scenario | null> => {
      if (!project?.id) return null;

      // Edit mode: scenarioId is in URL and scenario data is loaded
      if (scenario) {
        return updateMutation.mutateAsync({
          projectId: project.id,
          id: scenario.id,
          ...data,
        });
      }

      // Create mode: no scenarioId in URL yet
      return new Promise((resolve) => {
        checkCompoundLimits([scenarioEnforcement], async () => {
          try {
            const result = await createMutation.mutateAsync({
              projectId: project.id,
              ...data,
            });
            // Transition to edit mode to prevent double-create on subsequent saves.
            // Skip when the drawer is about to close (save-without-running).
            if (!skipTransition) {
              transitionToEditMode(result.id);
            }
            resolve(result);
          } catch {
            // Error already handled by global mutation cache if license error
            resolve(null);
          }
        });

        // If limit exceeded, modal is shown and callback won't run - resolve null
        if (!scenarioEnforcement.isAllowed) {
          resolve(null);
        }
      });
    },
    [project?.id, scenario, createMutation, updateMutation, scenarioEnforcement, transitionToEditMode],
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
          meta: { closable: true },
        });
        return;
      }
      try {
        await form.handleSubmit(async (data) => {
          const savedScenario = await handleSave(data);
          if (!savedScenario) return;

          // Persist the target selection for this scenario
          persistTarget(target);

          // Generate batchRunId so the simulations page can show a placeholder immediately
          const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();

          // Close drawer and navigate to simulations page BEFORE firing the run.
          // This ensures onRunComplete's openDrawer captures /simulations as the
          // current path, not /simulations/scenarios.
          onClose();
          await router.push(`/${project.slug}/simulations?pendingBatch=${batchRunId}`);

          // Now fire the run — onRunComplete will open the drawer on /simulations
          void runScenario({ scenarioId: savedScenario.id, target, batchRunId });
        })();
      } catch (error) {
        toaster.create({
          title: "Failed to run scenario",
          description:
            error instanceof Error ? error.message : "An error occurred",
          type: "error",
          meta: { closable: true },
        });
      }
    },
    [handleSave, project?.id, project?.slug, persistTarget, runScenario, formInstance, onClose, router],
  );
  const handleSaveWithoutRunning = useCallback(async () => {
    const form = formInstance;
    if (!form) return;
    await form.handleSubmit(async (data) => {
      try {
        const saved = await handleSave(data, { skipTransition: true });
        if (saved) {
          toaster.create({
            title: scenario ? "Scenario updated" : "Scenario created",
            type: "success",
            meta: { closable: true },
          });
          onClose();
        }
      } catch {
        // Error already handled by mutation onError callback
      }
    })();
  }, [handleSave, scenario, formInstance, onClose]);
  const setFormRef = useCallback((form: UseFormReturn<ScenarioFormData>) => {
    setFormInstance(form);
  }, []);
  const isSubmitting =
    createMutation.isPending || updateMutation.isPending || isRunning;

  // Use initial data from complexProps (new scenario from modal) or from DB (editing)
  const initialFormData =
    props.initialFormData ?? complexPropsData.initialFormData;
  const defaultValues: Partial<ScenarioFormData> | undefined = useMemo(
    () => scenario ?? initialFormData ?? undefined,
    [scenario, initialFormData],
  );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header borderBottomWidth="1px">
          <Heading size="md">
            {scenario ? "Edit Scenario" : "Create Scenario"}
          </Heading>
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
              <ScenarioForm
                key={scenarioId ?? "new"}
                defaultValues={defaultValues}
                formRef={setFormRef}
              />
            </GridItem>
            {/* Right: Help Sidebar */}
            <GridItem overflowY="auto" padding={4} bg="bg.muted">
              <ScenarioEditorSidebar form={formInstance} />
            </GridItem>
          </Grid>
        </Drawer.Body>
        {/* Bottom Bar */}
        <Drawer.Footer borderTopWidth="1px" justifyContent="space-between">
          {formInstance && (
            <FooterLabels form={formInstance} />
          )}
          <HStack gap={2} flexShrink={0}>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <SaveAndRunMenu
              selectedTarget={selectedTarget}
              onTargetChange={handleTargetChange}
              onSaveAndRun={handleSaveAndRun}
              onSaveWithoutRunning={handleSaveWithoutRunning}
              onCreateAgent={handleCreateAgent}
              onCreatePrompt={() => setPromptDrawerOpen(true)}
              isLoading={isSubmitting}
            />
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>

      {/* Agent Type Selector Drawer */}
      <AgentTypeSelectorDrawer
        open={agentTypeSelectorOpen}
        onClose={() => setAgentTypeSelectorOpen(false)}
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
            meta: { closable: true },
          });
        }}
      />
    </Drawer.Root>
  );
}

function FooterLabels({ form }: { form: UseFormReturn<ScenarioFormData> }) {
  const labels = useWatch({ control: form.control, name: "labels" });

  return (
    <HStack gap={2} flex={1} overflow="hidden" flexWrap="wrap">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" flexShrink={0}>
        Labels
      </Text>
      <TagList
        labels={labels}
        onRemove={(_label, index) =>
          form.setValue("labels", labels.filter((_, i) => i !== index))
        }
        onAdd={(label) => form.setValue("labels", [...labels, label])}
      />
    </HStack>
  );
}
