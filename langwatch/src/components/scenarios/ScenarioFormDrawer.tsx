import {
  Button,
  Grid,
  GridItem,
  Heading,
  HStack,
} from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { Play } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useDrawer, useDrawerParams } from "../../hooks/useDrawer";
import { api } from "../../utils/api";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { QuickTestBar } from "./QuickTestBar";
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
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const utils = api.useContext();
  const formRef = useRef<UseFormReturn<ScenarioFormData> | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string[]>([]);

  const scenarioId = params.scenarioId;
  const isOpen = props.open !== false && props.open !== undefined;
  const onClose = props.onClose ?? closeDrawer;

  const { data: scenario } = api.scenarios.getById.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project && !!scenarioId }
  );

  const createMutation = api.scenarios.create.useMutation({
    onSuccess: (data) => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
      toaster.create({
        title: "Scenario created",
        type: "success",
        meta: { closable: true },
      });
      props.onSuccess?.(data);
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to create scenario",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const updateMutation = api.scenarios.update.useMutation({
    onSuccess: (data) => {
      void utils.scenarios.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.scenarios.getById.invalidate({
        projectId: project?.id ?? "",
        id: data.id,
      });
      toaster.create({
        title: "Scenario updated",
        type: "success",
        meta: { closable: true },
      });
      props.onSuccess?.(data);
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to update scenario",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const handleSubmit = useCallback(
    (data: ScenarioFormData, runAfterSave: boolean = false) => {
      if (!project?.id) return;

      if (scenario) {
        updateMutation.mutate({
          projectId: project.id,
          id: scenario.id,
          ...data,
        });
      } else {
        createMutation.mutate({
          projectId: project.id,
          ...data,
        });
      }

      // TODO: Handle runAfterSave when run functionality is implemented
    },
    [project?.id, scenario, createMutation, updateMutation]
  );

  const handleSaveAndRun = useCallback(() => {
    if (formRef.current) {
      formRef.current.handleSubmit((data) => handleSubmit(data, true))();
    }
  }, [handleSubmit]);

  const handleSaveWithoutRunning = useCallback(() => {
    if (formRef.current) {
      formRef.current.handleSubmit((data) => handleSubmit(data, false))();
    }
  }, [handleSubmit]);

  const setFormRef = useCallback((form: UseFormReturn<ScenarioFormData>) => {
    formRef.current = form;
  }, []);

  const isSubmitting = createMutation.isLoading || updateMutation.isLoading;

  const defaultValues: Partial<ScenarioFormData> | undefined = scenario ?? undefined;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header borderBottomWidth="1px">
          <Heading size="md">Edit Scenario</Heading>
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
            selectedPromptId={selectedPromptId}
            onPromptChange={setSelectedPromptId}
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
    </Drawer.Root>
  );
}
