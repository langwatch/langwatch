import { Grid, GridItem, Heading } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { getComplexProps, useDrawer, useDrawerParams } from "../../hooks/useDrawer";
import { checkCompoundLimits } from "../../hooks/useCompoundLicenseCheck";
import { useLicenseEnforcement } from "../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRunScenario } from "../../hooks/useRunScenario";
import { useScenarioTarget } from "../../hooks/useScenarioTarget";
import { api } from "../../utils/api";
import { isHandledByGlobalLicenseHandler } from "../../utils/trpcError";
import { AgentHttpEditorDrawer } from "../agents/AgentHttpEditorDrawer";
import { PromptEditorDrawer } from "../prompts/PromptEditorDrawer";
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
} & Partial<ScenarioInitialData>;

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
  const { closeDrawer, openDrawer } = useDrawer();
  const params = useDrawerParams();
  const rawComplexProps = getComplexProps();
  const complexPropsData =
    rawComplexProps && "initialFormData" in rawComplexProps
      ? (rawComplexProps as Partial<ScenarioInitialData>)
      : {};
  const utils = api.useContext();
  const [formInstance, setFormInstance] =
    useState<UseFormReturn<ScenarioFormData> | null>(null);
  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const scenarioId = params.scenarioId;

  // License enforcement for scenario creation
  const scenarioEnforcement = useLicenseEnforcement("scenarios");

  // Target selection with localStorage persistence
  const { target: persistedTarget, setTarget: persistTarget } =
    useScenarioTarget(scenarioId);
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(null);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);

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
      if (isHandledByGlobalLicenseHandler(error)) return;
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
      if (isHandledByGlobalLicenseHandler(error)) return;
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
    async (data: ScenarioFormData): Promise<Scenario | null> => {
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
            // Transition to edit mode to prevent double-create on subsequent saves
            transitionToEditMode(result.id);
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
      if (!form || !project?.id) return;
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

          await runScenario({ scenarioId: savedScenario.id, target });
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
    [handleSave, project?.id, persistTarget, runScenario, formInstance],
  );
  const handleSaveWithoutRunning = useCallback(async () => {
    const form = formInstance;
    if (!form) return;
    await form.handleSubmit(async (data) => {
      const saved = await handleSave(data);
      if (saved) {
        toaster.create({
          title: scenario ? "Scenario updated" : "Scenario created",
          type: "success",
          meta: { closable: true },
        });
      }
    })();
  }, [handleSave, scenario, formInstance]);
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
      closeOnInteractOutside={false}
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
      modal={false}
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
            <GridItem overflowY="auto" padding={4} bg="bg.subtle">
              <ScenarioEditorSidebar form={formInstance} />
            </GridItem>
          </Grid>
        </Drawer.Body>
        {/* Bottom Bar */}
        <Drawer.Footer borderTopWidth="1px" justifyContent="flex-end">
          <SaveAndRunMenu
            selectedTarget={selectedTarget}
            onTargetChange={handleTargetChange}
            onSaveAndRun={handleSaveAndRun}
            onSaveWithoutRunning={handleSaveWithoutRunning}
            onCreateAgent={() => setAgentDrawerOpen(true)}
            onCreatePrompt={() => setPromptDrawerOpen(true)}
            isLoading={isSubmitting}
          />
        </Drawer.Footer>
      </Drawer.Content>

      {/* Agent Creation Drawer */}
      <AgentHttpEditorDrawer
        open={agentDrawerOpen}
        onClose={() => setAgentDrawerOpen(false)}
        onSave={(agent) => {
          // Auto-select the newly created agent
          handleTargetChange({ type: "http", id: agent.id });
          setAgentDrawerOpen(false);
          toaster.create({
            title: "Agent created",
            description: `"${agent.name}" is now selected as the target.`,
            type: "success",
            meta: { closable: true },
          });
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
            meta: { closable: true },
          });
        }}
      />
    </Drawer.Root>
  );
}
