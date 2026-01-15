import {
  Button,
  Grid,
  GridItem,
  Heading,
  HStack,
} from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { Play } from "lucide-react";
import { useRouter } from "next/router";
import { useCallback, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useDrawer, useDrawerParams } from "../../hooks/useDrawer";
import { api } from "../../utils/api";
import { PromptEditorDrawer } from "../prompts/PromptEditorDrawer";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { pollForScenarioRun } from "../../utils/pollForScenarioRun";
import { buildRoutePath } from "../../utils/routes";
import { QuickTestBar } from "./QuickTestBar";
import type { TargetType } from "./TargetTypeSelector";
import { ScenarioEditorSidebar } from "./ScenarioEditorSidebar";
import { ScenarioForm, type ScenarioFormData } from "./ScenarioForm";
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
  const [targetType, setTargetType] = useState<TargetType>("prompt");
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const runMutation = api.scenarios.run.useMutation();
  const scenarioId = params.scenarioId;
  const isOpen = props.open !== false && props.open !== undefined;
  const onClose = props.onClose ?? closeDrawer;
  const { data: scenario } = api.scenarios.getById.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project && !!scenarioId }
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
    [project?.id, scenario, createMutation, updateMutation]
  );
  const handleSaveAndRun = useCallback(async () => {
    const form = formRef.current;
    if (!form || !project?.id) return;
    if (!selectedTargetId) {
      toaster.create({
        title: targetType === "prompt" ? "Select a prompt" : "Select an HTTP agent",
        description: `Please select a ${targetType === "prompt" ? "prompt" : "HTTP agent"} to run the scenario against.`,
        type: "warning",
        meta: { closable: true },
      });
      return;
    }
    await form.handleSubmit(async (data) => {
      const savedScenario = await handleSave(data);
      if (!savedScenario) return;
      const { setId, batchRunId } = await runMutation.mutateAsync({
        projectId: project.id,
        scenarioId: savedScenario.id,
        target: { type: targetType, referenceId: selectedTargetId },
      });

      // Poll for the run to appear, then redirect to the specific run
      const scenarioRunId = await pollForScenarioRun(
        utils.scenarios.getBatchRunData.fetch,
        { projectId: project.id, scenarioSetId: setId, batchRunId }
      );

      if (scenarioRunId) {
        void router.push(
          buildRoutePath("simulations_run", {
            project: project.slug,
            scenarioSetId: setId,
            batchRunId,
            scenarioRunId,
          })
        );
      } else {
        // Fallback to batch page if polling times out
        void router.push(
          buildRoutePath("simulations_batch", {
            project: project.slug,
            scenarioSetId: setId,
            batchRunId,
          })
        );
      }
    })();
  }, [handleSave, project, selectedTargetId, targetType, runMutation, router, utils]);
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
  const isSubmitting = createMutation.isPending || updateMutation.isPending || runMutation.isPending;
  const defaultValues: Partial<ScenarioFormData> | undefined = useMemo(() => scenario ?? undefined, [scenario]);
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
          <Heading size="md">{scenario ? "Edit Scenario" : "Create Scenario"}</Heading>
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
        <Drawer.Footer borderTopWidth="1px" justifyContent="space-between">
          <QuickTestBar
            targetType={targetType}
            onTargetTypeChange={(type) => {
              setTargetType(type);
              setSelectedTargetId(null);
            }}
            selectedTargetId={selectedTargetId}
            onTargetIdChange={setSelectedTargetId}
            onCreatePrompt={() => setPromptDrawerOpen(true)}
          />
          <HStack gap={2}>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveWithoutRunning}
              loading={isSubmitting}
            >
              Save
            </Button>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={handleSaveAndRun}
              loading={isSubmitting}
            >
              <Play size={14} />
              Save and Run
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>

      {/* Prompt Creation Drawer */}
      <PromptEditorDrawer
        open={promptDrawerOpen}
        onClose={() => setPromptDrawerOpen(false)}
        onSave={(prompt) => {
          // Auto-select the newly created prompt
          setSelectedTargetId(prompt.id);
          setPromptDrawerOpen(false);
        }}
      />
    </Drawer.Root>
  );
}
