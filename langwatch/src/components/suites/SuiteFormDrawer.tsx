/**
 * Drawer for creating and editing suite configurations.
 *
 * Uses the drawer registry pattern (URL-based state management) for proper
 * focus trap stacking when child drawers (scenarioEditor, agentHttpEditor)
 * are opened.
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
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { useCallback } from "react";
import {
  useDrawer,
  useDrawerParams,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { useSuiteForm, type SuiteFormData } from "./useSuiteForm";
import { InlineTagsInput } from "../scenarios/ui/InlineTagsInput";
import { ScenarioPicker } from "./ScenarioPicker";
import { TargetPicker } from "./TargetPicker";

/** Callbacks passed via flowCallbacks from the parent page. */
export type SuiteFormDrawerProps = {
  onSaved?: (suite: SimulationSuite) => void;
  onRan?: (suiteId: string) => void;
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
  const { openDrawer, closeDrawer, drawerOpen } = useDrawer();
  const params = useDrawerParams();
  const utils = api.useContext();

  const isOpen = drawerOpen("suiteEditor");
  const suiteId = params.suiteId;

  // Get flow callbacks for onSaved / onRan
  const callbacks = getFlowCallbacks("suiteEditor");
  const onSaved = callbacks?.onSaved;
  const onRan = callbacks?.onRan;

  // Fetch suite data when editing
  const { data: suite } = api.suites.getById.useQuery(
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
  const title = isEditMode ? "Edit Suite" : "New Suite";

  const suiteForm = useSuiteForm({
    suite: suite ?? null,
    isOpen,
    suiteId,
    scenarios,
    agents,
    prompts,
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
        title: "Suite created",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to create suite",
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
        title: "Suite updated",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to update suite",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const runMutation = api.suites.run.useMutation({
    onSuccess: (result) => {
      const archivedCount =
        (result.skippedArchived?.scenarios?.length ?? 0) +
        (result.skippedArchived?.targets?.length ?? 0);

      if (archivedCount > 0) {
        const parts: string[] = [];
        if (result.skippedArchived.scenarios.length > 0) {
          parts.push(`${result.skippedArchived.scenarios.length} archived scenario${result.skippedArchived.scenarios.length > 1 ? "s" : ""}`);
        }
        if (result.skippedArchived.targets.length > 0) {
          parts.push(`${result.skippedArchived.targets.length} archived target${result.skippedArchived.targets.length > 1 ? "s" : ""}`);
        }

        toaster.create({
          title: `Suite run scheduled (${result.jobCount} jobs)`,
          description: `${parts.join(" and ")} skipped.`,
          type: "warning",
          meta: { closable: true },
        });
      } else {
        toaster.create({
          title: `Suite run scheduled (${result.jobCount} jobs)`,
          type: "success",
          meta: { closable: true },
        });
      }
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to run suite",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
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
        runMutation.mutate({ projectId: payload.projectId, id: saved.id });
        onRan?.(saved.id);
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
      runMutation,
      onRan,
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
          <VStack gap={4} align="stretch">
            {/* Name */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Name *
              </Text>
              <Input
                placeholder="e.g., Critical Path Suite"
                {...form.register("name")}
                borderColor={errors.name ? "red.500" : undefined}
              />
              {errors.name && (
                <Text fontSize="xs" color="red.500">
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

            {/* Labels */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Labels
              </Text>
              <InlineTagsInput
                value={suiteForm.labels}
                onChange={(newLabels) => form.setValue("labels", newLabels)}
                placeholder="Add label..."
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
                onCreateNew={() => openDrawer("scenarioEditor")}
                hasError={!!errors.selectedScenarioIds}
                archivedIds={suiteForm.archivedScenarioIds}
                onRemoveArchived={suiteForm.removeArchivedScenario}
              />
              {errors.selectedScenarioIds && (
                <Text fontSize="xs" color="red.500">
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
                searchQuery={suiteForm.targetSearch}
                onSearchChange={suiteForm.setTargetSearch}
                onCreateAgent={() => openDrawer("agentHttpEditor")}
                onCreatePrompt={() => {
                  if (project?.slug) {
                    window.open(`/${project.slug}/prompts`, "_blank");
                  }
                }}
                hasError={!!errors.selectedTargets}
                archivedIds={suiteForm.archivedTargetIds}
                onRemoveArchived={suiteForm.removeArchivedTarget}
              />
              {errors.selectedTargets && (
                <Text fontSize="xs" color="red.500">
                  {errors.selectedTargets.message}
                </Text>
              )}
              {suiteForm.staleTargetIds.length > 0 && (
                <HStack
                  gap={2}
                  padding={2}
                  borderRadius="md"
                  backgroundColor="orange.50"
                  _dark={{ backgroundColor: "orange.900" }}
                  data-testid="stale-targets-warning"
                >
                  <AlertTriangle size={14} color="var(--chakra-colors-orange-500)" />
                  <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.200" }}>
                    {suiteForm.staleTargetIds.length === 1
                      ? "1 target is no longer available and may have been deleted."
                      : `${suiteForm.staleTargetIds.length} targets are no longer available and may have been deleted.`}
                  </Text>
                </HStack>
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
                      <Text fontSize="xs" color="red.500">
                        {errors.repeatCount.message}
                      </Text>
                    )}
                  </VStack>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>

            {/* Triggers - placeholder */}
            <Collapsible.Root>
              <Collapsible.Trigger asChild>
                <HStack cursor="pointer" gap={2}>
                  <ChevronRight size={14} />
                  <Text fontSize="sm" fontWeight="medium">
                    Triggers
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
                  <Text fontSize="sm" color="fg.muted">
                    Coming soon
                  </Text>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>
          </VStack>
        </Drawer.Body>

        <Drawer.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={handleSave} loading={isSaving}>
              Save
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleRunNow}
              loading={isSaving || runMutation.isPending}
            >
              <Play size={14} />
              Run Now
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
