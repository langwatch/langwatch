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
import { useSuiteForm } from "./useSuiteForm";
import { InlineTagsInput } from "../scenarios/ui/InlineTagsInput";
import { ScenarioPicker } from "./ScenarioPicker";
import { TargetPicker } from "./TargetPicker";

/** Callbacks passed via flowCallbacks from the parent page. */
export type SuiteFormDrawerProps = {
  onSaved?: (suite: SimulationSuite) => void;
  onRan?: (suiteId: string) => void;
};

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

  const form = useSuiteForm({
    suite: suite ?? null,
    isOpen,
    suiteId,
    scenarios,
    agents,
    prompts,
  });

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
      toaster.create({
        title: `Suite run scheduled (${result.jobCount} jobs)`,
        type: "success",
        meta: { closable: true },
      });
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

  const handleSave = useCallback(() => {
    if (!form.validate() || !project) return;
    const data = form.buildFormData({ projectId: project.id });

    if (isEditMode && suite) {
      updateMutation.mutate({ ...data, id: suite.id });
    } else {
      createMutation.mutate(data);
    }
  }, [form, project, isEditMode, suite, createMutation, updateMutation]);

  const handleRunNow = useCallback(() => {
    if (!form.validate() || !project) return;
    const data = form.buildFormData({ projectId: project.id });

    const onSuccess = (saved: SimulationSuite) => {
      runMutation.mutate({ projectId: data.projectId, id: saved.id });
      onRan?.(saved.id);
    };

    if (isEditMode && suite) {
      updateMutation.mutate({ ...data, id: suite.id }, { onSuccess });
    } else {
      createMutation.mutate(data, { onSuccess });
    }
  }, [
    form,
    project,
    isEditMode,
    suite,
    createMutation,
    updateMutation,
    runMutation,
    onRan,
  ]);

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
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                borderColor={form.errors.name ? "red.500" : undefined}
              />
              {form.errors.name && (
                <Text fontSize="xs" color="red.500">
                  {form.errors.name}
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
                value={form.description}
                onChange={(e) => form.setDescription(e.target.value)}
                rows={2}
              />
            </VStack>

            {/* Labels */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Labels
              </Text>
              <InlineTagsInput
                value={form.labels}
                onChange={form.setLabels}
                placeholder="Add label..."
              />
            </VStack>

            {/* Scenarios */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Scenarios *
              </Text>
              <ScenarioPicker
                scenarios={form.filteredScenarios}
                selectedIds={form.selectedScenarioIds}
                totalCount={form.totalScenarioCount}
                onToggle={form.toggleScenario}
                onSelectAll={form.selectAllScenarios}
                onClear={form.clearScenarios}
                searchQuery={form.scenarioSearch}
                onSearchChange={form.setScenarioSearch}
                allLabels={form.allLabels}
                activeLabelFilter={form.activeLabelFilter}
                onLabelFilterChange={form.setActiveLabelFilter}
                onCreateNew={() => openDrawer("scenarioEditor")}
                hasError={!!form.errors.scenarios}
              />
              {form.errors.scenarios && (
                <Text fontSize="xs" color="red.500">
                  {form.errors.scenarios}
                </Text>
              )}
            </VStack>

            {/* Targets */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Target(s) *
              </Text>
              <TargetPicker
                targets={form.filteredTargets}
                selectedTargets={form.selectedTargets}
                totalCount={form.availableTargets.length}
                isTargetSelected={form.isTargetSelected}
                onToggle={form.toggleTarget}
                searchQuery={form.targetSearch}
                onSearchChange={form.setTargetSearch}
                onCreateAgent={() => openDrawer("agentHttpEditor")}
                onCreatePrompt={() => {
                  if (project?.slug) {
                    window.open(`/${project.slug}/prompts`, "_blank");
                  }
                }}
                hasError={!!form.errors.targets}
              />
              {form.errors.targets && (
                <Text fontSize="xs" color="red.500">
                  {form.errors.targets}
                </Text>
              )}
              {form.staleTargetIds.length > 0 && (
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
                    {form.staleTargetIds.length === 1
                      ? "1 target is no longer available and may have been deleted."
                      : `${form.staleTargetIds.length} targets are no longer available and may have been deleted.`}
                  </Text>
                </HStack>
              )}
            </VStack>

            {/* Execution Options */}
            <Collapsible.Root
              open={form.executionOptionsOpen}
              onOpenChange={(d) => form.setExecutionOptionsOpen(d.open)}
            >
              <Collapsible.Trigger asChild>
                <HStack cursor="pointer" gap={2}>
                  {form.executionOptionsOpen ? (
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
                        value={form.repeatCountStr}
                        onChange={(e) => form.setRepeatCountStr(e.target.value)}
                        borderColor={form.errors.repeatCount ? "red.500" : undefined}
                      />
                      <Text fontSize="xs" color="fg.muted">
                        times per scenario x target (max {MAX_REPEAT_COUNT})
                      </Text>
                    </HStack>
                    {form.errors.repeatCount && (
                      <Text fontSize="xs" color="red.500">
                        {form.errors.repeatCount}
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
