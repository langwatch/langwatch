import { Grid, GridItem, Heading } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useDrawer, useDrawerParams } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useScenarioTarget } from "../../hooks/useScenarioTarget";
import { api } from "../../utils/api";
import { pollForScenarioRun } from "../../utils/pollForScenarioRun";
import { buildRoutePath } from "../../utils/routes";
import { AgentHttpEditorDrawer } from "../agents/AgentHttpEditorDrawer";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { SaveAndRunMenu } from "./SaveAndRunMenu";
import { ScenarioEditorSidebar } from "./ScenarioEditorSidebar";
import { ScenarioForm, type ScenarioFormData } from "./ScenarioForm";
import type { TargetValue } from "./TargetSelector";
export type ScenarioFormDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (scenario: Scenario) => void;
};
/**
 * Drawer container for scenario create/edit form.
 * Two-column layout: form on left, help sidebar on right.
 * Bottom bar with Quick Test and Save and Run.
 */
export function ScenarioFormDrawer(props: ScenarioFormDrawerProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const utils = api.useContext();
  const formRef = useRef<UseFormReturn<ScenarioFormData> | null>(null);
  const runMutation = api.scenarios.run.useMutation();
  const scenarioId = params.scenarioId;

  // Target selection with localStorage persistence
  const { target: persistedTarget, setTarget: persistTarget } =
    useScenarioTarget(scenarioId);
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(null);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);

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
    onError: (error: { message: string }) => {
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
    onError: (error: { message: string }) => {
      toaster.create({
        title: "Failed to update scenario",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });
  const handleSave = useCallback(
    async (data: ScenarioFormData): Promise<Scenario | null> => {
      if (!project?.id) return null;
      if (scenario) {
        return updateMutation.mutateAsync({
          projectId: project.id,
          id: scenario.id,
          ...data,
        });
      } else {
        return createMutation.mutateAsync({
          projectId: project.id,
          ...data,
        });
      }
    },
    [project?.id, scenario, createMutation, updateMutation],
  );
  const handleSaveAndRun = useCallback(
    async (target: TargetValue) => {
      const form = formRef.current;
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

          const { setId, batchRunId } = await runMutation.mutateAsync({
            projectId: project.id,
            scenarioId: savedScenario.id,
            target: { type: target.type, referenceId: target.id },
          });

          // Poll for the run to appear, then redirect to the specific run
          const scenarioRunId = await pollForScenarioRun(
            utils.scenarios.getBatchRunData.fetch,
            { projectId: project.id, scenarioSetId: setId, batchRunId },
          );

          if (scenarioRunId) {
            void router.push(
              buildRoutePath("simulations_run", {
                project: project.slug,
                scenarioSetId: setId,
                batchRunId,
                scenarioRunId,
              }),
            );
          } else {
            toaster.create({
              title: "Run timed out",
              description:
                "The scenario run took too long to start. Please try again.",
              type: "error",
              meta: { closable: true },
            });
          }
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
    [handleSave, project, persistTarget, runMutation, router, utils],
  );
  const handleSaveWithoutRunning = useCallback(async () => {
    const form = formRef.current;
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
  }, [handleSave, scenario]);
  const setFormRef = useCallback((form: UseFormReturn<ScenarioFormData>) => {
    formRef.current = form;
  }, []);
  const isSubmitting =
    createMutation.isPending ||
    updateMutation.isPending ||
    runMutation.isPending;
  const defaultValues: Partial<ScenarioFormData> | undefined = useMemo(
    () => scenario ?? undefined,
    [scenario],
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
              borderColor="gray.200"
            >
              <ScenarioForm
                key={scenarioId ?? "new"}
                defaultValues={defaultValues}
                formRef={setFormRef}
              />
            </GridItem>
            {/* Right: Help Sidebar */}
            <GridItem overflowY="auto" padding={4} bg="gray.50">
              <ScenarioEditorSidebar />
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
        }}
      />
    </Drawer.Root>
  );
}
