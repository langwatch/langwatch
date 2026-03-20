/**
 * Drawer for creating and editing suite configurations.
 *
 * Child drawers (scenarioEditor, agentHttpEditor) are rendered via local
 * React state so the parent stays mounted and form state is preserved.
 * The suite editor itself uses URL-based drawer registration for root-level
 * opening.
 *
 * This is a thin orchestrator that composes:
 * - `useSuiteForm` for all form state and logic
 * - `ScenarioPicker` for scenario selection UI
 * - `TargetPicker` for target selection UI
 */

import {
  Box,
  Button,
  Collapsible,
  HStack,
  Input,
  Skeleton,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { useCallback, useState } from "react";
import {
  useDrawer,
  useDrawerParams,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AgentHttpEditorDrawer } from "../agents/AgentHttpEditorDrawer";
import { ScenarioFormDrawer } from "../scenarios/ScenarioFormDrawer";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { useSuiteForm, type SuiteFormData } from "./useSuiteForm";
import { useArchivedItemsResolution } from "./useArchivedItemsResolution";
import { useSuiteRunMutation } from "./useSuiteRunMutation";
import { ScenarioPicker } from "./ScenarioPicker";
import { TargetPicker } from "./TargetPicker";

/** Callbacks passed via flowCallbacks from the parent page. */
export type SuiteFormDrawerProps = {
  onSaved?: (suite: SimulationSuite) => void;
  onRunRequested?: (suite: SimulationSuite) => void;
};

/** Build the mutation payload from validated form data. */
function buildMutationPayload(data: SuiteFormData, projectId: string) {
  return {
    projectId,
    name: data.name.trim(),
    description: data.description.trim() || undefined,
    scenarioIds: data.selectedScenarioIds,
    targets: data.selectedTargets,
    repeatCount: data.repeatCount,
    labels: data.labels,
  };
}

export function SuiteFormDrawer(_props: SuiteFormDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, drawerOpen, openDrawer } = useDrawer();
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);
  const [agentHttpEditorOpen, setAgentHttpEditorOpen] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const params = useDrawerParams();
  const utils = api.useContext();

  const isOpen = drawerOpen("suiteEditor");
  const suiteId = params.suiteId;

  // Get flow callbacks for onSaved / onRunRequested
  const callbacks = getFlowCallbacks("suiteEditor");
  const onSaved = callbacks?.onSaved;
  const onRunRequested = callbacks?.onRunRequested;

  // Fetch suite data when editing
  const { data: suite, isLoading: isSuiteLoading } = api.suites.getById.useQuery(
    { projectId: project?.id ?? "", id: suiteId ?? "" },
    { enabled: !!project && !!suiteId && isOpen },
  );

  // Fetch available scenarios and targets
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );

  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );

  const isEditMode = !!suiteId;
  const title = isEditMode ? "Edit Run Plan" : "New Run Plan";

  const suiteForm = useSuiteForm({
    suite: suite ?? null,
    isOpen,
    suiteId,
    scenarios,
    agents,
    prompts,
  });

  const { archivedScenariosWithNames, archivedTargetsWithNames } =
    useArchivedItemsResolution({
      archivedScenarioIds: suiteForm.archivedScenarioIds,
      archivedTargets: suiteForm.archivedTargets,
      projectId: project?.id,
    });

  const { form } = suiteForm;
  const errors = form.formState.errors;

  // -- Mutations --

  const createMutation = api.suites.create.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      onSaved?.(data);
      closeDrawer();
      toaster.create({
        title: "Run plan created",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to create run plan",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const updateMutation = api.suites.update.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      void utils.suites.getById.invalidate({
        projectId: project?.id ?? "",
        id: data.id,
      });
      onSaved?.(data);
      closeDrawer();
      toaster.create({
        title: "Run plan updated",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to update run plan",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const { runMutation } = useSuiteRunMutation({
    onEditSuite: (suiteId) => {
      openDrawer("suiteEditor", { urlParams: { suiteId } });
    },
  });

  const submitForm = useCallback(
    (data: SuiteFormData) => {
      if (!project) return;
      const payload = buildMutationPayload(data, project.id);

      if (isEditMode && suite) {
        updateMutation.mutate({ ...payload, id: suite.id });
      } else {
        createMutation.mutate(payload);
      }
    },
    [project, isEditMode, suite, createMutation, updateMutation],
  );

  const submitAndRun = useCallback(
    (data: SuiteFormData) => {
      if (!project) return;
      const payload = buildMutationPayload(data, project.id);

      const onSuccess = (saved: SimulationSuite) => {
        closeDrawer();
        if (onRunRequested) {
          onRunRequested(saved);
        } else {
          runMutation.mutate({ projectId: payload.projectId, id: saved.id, idempotencyKey });
        }
      };

      if (isEditMode && suite) {
        updateMutation.mutate({ ...payload, id: suite.id }, { onSuccess });
      } else {
        createMutation.mutate(payload, { onSuccess });
      }
    },
    [
      project,
      isEditMode,
      suite,
      createMutation,
      updateMutation,
      closeDrawer,
      onRunRequested,
    ],
  );

  const handleSave = useCallback(() => {
    void form.handleSubmit(submitForm)();
  }, [form, submitForm]);

  const handleRunNow = useCallback(() => {
    void form.handleSubmit(submitAndRun)();
  }, [form, submitAndRun]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
  <>
    <Drawer.Root
      open={isOpen}
      onOpenChange={(e) => {
        if (!e.open) closeDrawer();
      }}
      placement="end"
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body>
          {isEditMode && isSuiteLoading ? (
            <VStack gap={4} align="stretch">
              <Skeleton height="20px" width="60px" />
              <Skeleton height="40px" />
              <Skeleton height="20px" width="80px" />
              <Skeleton height="80px" />
              <Skeleton height="20px" width="70px" />
              <Skeleton height="120px" />
              <Skeleton height="20px" width="60px" />
              <Skeleton height="120px" />
            </VStack>
          ) : (
          <VStack gap={4} align="stretch">
            {/* Name */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Name *
              </Text>
              <Input
                placeholder="e.g., Critical Path Run Plan"
                {...form.register("name")}
                borderColor={errors.name ? "red.500" : undefined}
              />
              {errors.name && (
                <Text fontSize="xs" color="red.fg">
                  {errors.name.message}
                </Text>
              )}
            </VStack>

            {/* Description */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Description (optional)
              </Text>
              <Textarea
                placeholder="Core journeys that must pass before deploy"
                {...form.register("description")}
                rows={2}
              />
            </VStack>

            {/* Scenarios */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Scenarios *
              </Text>
              <ScenarioPicker
                scenarios={suiteForm.filteredScenarios}
                selectedIds={suiteForm.selectedScenarioIds}
                totalCount={suiteForm.totalScenarioCount}
                onToggle={suiteForm.toggleScenario}
                onSelectAll={suiteForm.selectAllScenarios}
                onClear={suiteForm.clearScenarios}
                searchQuery={suiteForm.scenarioSearch}
                onSearchChange={suiteForm.setScenarioSearch}
                allLabels={suiteForm.allLabels}
                activeLabelFilter={suiteForm.activeLabelFilter}
                onLabelFilterChange={suiteForm.setActiveLabelFilter}
                onCreateNew={() => setScenarioEditorOpen(true)}
                hasError={!!errors.selectedScenarioIds}
                archivedIds={archivedScenariosWithNames}
                onRemoveArchived={suiteForm.removeArchivedScenario}
              />
              {errors.selectedScenarioIds && (
                <Text fontSize="xs" color="red.fg">
                  {errors.selectedScenarioIds.message}
                </Text>
              )}
            </VStack>

            {/* Targets */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Target(s) *
              </Text>
              <TargetPicker
                targets={suiteForm.filteredTargets}
                selectedTargets={suiteForm.selectedTargets}
                totalCount={suiteForm.availableTargets.length}
                isTargetSelected={suiteForm.isTargetSelected}
                onToggle={suiteForm.toggleTarget}
                onSelectAll={suiteForm.selectAllTargets}
                onClear={suiteForm.clearTargets}
                searchQuery={suiteForm.targetSearch}
                onSearchChange={suiteForm.setTargetSearch}
                onAddTarget={() => setAgentHttpEditorOpen(true)}
                hasError={!!errors.selectedTargets}
                archivedTargets={archivedTargetsWithNames}
                onRemoveArchived={suiteForm.removeArchivedTarget}
              />
              {errors.selectedTargets && (
                <Text fontSize="xs" color="red.fg">
                  {errors.selectedTargets.message}
                </Text>
              )}
            </VStack>

            {/* Execution Options */}
            <Collapsible.Root
              open={suiteForm.executionOptionsOpen}
              onOpenChange={(d) => suiteForm.setExecutionOptionsOpen(d.open)}
            >
              <Collapsible.Trigger asChild>
                <HStack cursor="pointer" gap={2}>
                  {suiteForm.executionOptionsOpen ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <Text fontSize="sm" fontWeight="medium">
                    Execution Options
                  </Text>
                </HStack>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <Box
                  border="1px solid"
                  borderColor="border"
                  borderRadius="md"
                  padding={3}
                  marginTop={2}
                >
                  <VStack align="start" gap={1}>
                    <HStack gap={2} align="center">
                      <Text fontSize="sm">Repeat count</Text>
                      <Input
                        type="number"
                        size="sm"
                        width="80px"
                        min={1}
                        max={MAX_REPEAT_COUNT}
                        {...form.register("repeatCount", {
                          valueAsNumber: true,
                        })}
                        borderColor={
                          errors.repeatCount ? "red.500" : undefined
                        }
                      />
                      <Text fontSize="xs" color="fg.muted">
                        times per scenario x target (max {MAX_REPEAT_COUNT})
                      </Text>
                    </HStack>
                    {errors.repeatCount && (
                      <Text fontSize="xs" color="red.fg">
                        {errors.repeatCount.message}
                      </Text>
                    )}
                  </VStack>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>
          </VStack>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={handleSave} loading={isSaving}>
              Save
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleRunNow}
              loading={isSaving}
            >
              <Play size={14} />
              Run Now
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>

    {/* Child drawer: Scenario Editor -- managed via local state */}
    <ScenarioFormDrawer
      open={scenarioEditorOpen}
      onClose={() => setScenarioEditorOpen(false)}
    />

    {/* Child drawer: Agent HTTP Editor -- managed via local state */}
    <AgentHttpEditorDrawer
      open={agentHttpEditorOpen}
      onClose={() => setAgentHttpEditorOpen(false)}
    />
  </>
  );
}
