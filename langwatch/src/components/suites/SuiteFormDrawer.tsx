/**
 * Drawer for creating and editing suite configurations.
 *
 * Shows fields for Name, Description, Labels, Scenarios (with search + filter),
 * Targets (with search + type indicator), Execution Options, and Save/Run Now buttons.
 */

import {
  Badge,
  Box,
  Button,
  Collapsible,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import {
  ChevronDown,
  ChevronRight,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  parseSuiteTargets,
  type SuiteTarget,
} from "~/server/api/routers/suites/schemas";
import { api } from "~/utils/api";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { Checkbox } from "../ui/checkbox";

export type SuiteFormDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Pre-populated data for edit mode */
  suite?: SimulationSuiteConfiguration | null;
  /** Called after successful save */
  onSaved?: (suite: SimulationSuiteConfiguration) => void;
  /** Called after successful save + run */
  onRan?: (suiteId: string) => void;
};

export function SuiteFormDrawer({
  open,
  onClose,
  suite,
  onSaved,
  onRan,
}: SuiteFormDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  const isEditMode = !!suite;
  const title = isEditMode ? "Edit Suite" : "New Suite";

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<SuiteTarget[]>([]);
  const [repeatCount, setRepeatCount] = useState(1);
  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);

  // Search state
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(null);

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch available scenarios and targets
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && open },
  );

  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && open },
  );

  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && open },
  );

  // Build available targets from agents + prompts
  const availableTargets = useMemo(() => {
    const result: Array<{ name: string; type: "http" | "prompt"; referenceId: string }> = [];
    if (agents) {
      for (const agent of agents) {
        result.push({
          name: agent.name,
          type: "http",
          referenceId: agent.id,
        });
      }
    }
    if (prompts) {
      for (const prompt of prompts) {
        result.push({
          name: prompt.handle ?? prompt.name,
          type: "prompt",
          referenceId: prompt.id,
        });
      }
    }
    return result;
  }, [agents, prompts]);

  // All unique scenario labels
  const allLabels = useMemo(() => {
    if (!scenarios) return [];
    const labelSet = new Set<string>();
    for (const s of scenarios) {
      for (const l of s.labels) {
        labelSet.add(l);
      }
    }
    return Array.from(labelSet).sort();
  }, [scenarios]);

  // Filter scenarios
  const filteredScenarios = useMemo(() => {
    if (!scenarios) return [];
    let filtered = scenarios;
    if (scenarioSearch.trim()) {
      const q = scenarioSearch.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (activeLabelFilter) {
      filtered = filtered.filter((s) => s.labels.includes(activeLabelFilter));
    }
    return filtered;
  }, [scenarios, scenarioSearch, activeLabelFilter]);

  // Filter targets
  const filteredTargets = useMemo(() => {
    if (!targetSearch.trim()) return availableTargets;
    const q = targetSearch.toLowerCase();
    return availableTargets.filter((t) => t.name.toLowerCase().includes(q));
  }, [availableTargets, targetSearch]);

  // Initialize form for edit mode
  useEffect(() => {
    if (suite && open) {
      setName(suite.name);
      setDescription(suite.description ?? "");
      setLabels(suite.labels);
      setSelectedScenarioIds(suite.scenarioIds);
      setSelectedTargets(parseSuiteTargets(suite.targets));
      setRepeatCount(suite.repeatCount);
      setErrors({});
    } else if (!suite && open) {
      // Reset for new suite
      setName("");
      setDescription("");
      setLabels([]);
      setSelectedScenarioIds([]);
      setSelectedTargets([]);
      setRepeatCount(1);
      setErrors({});
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
    }
  }, [suite, open]);

  // Mutations
  const createMutation = api.suites.create.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      onSaved?.(data);
      onClose();
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
      void utils.suites.getById.invalidate({ projectId: project?.id ?? "", id: data.id });
      onSaved?.(data);
      onClose();
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

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = "Name is required";
    }
    if (selectedScenarioIds.length === 0) {
      newErrors.scenarios = "At least one scenario is required";
    }
    if (selectedTargets.length === 0) {
      newErrors.targets = "At least one target is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, selectedScenarioIds, selectedTargets]);

  const buildFormData = useCallback(() => {
    if (!project) return null;
    return {
      projectId: project.id,
      name: name.trim(),
      description: description.trim() || undefined,
      scenarioIds: selectedScenarioIds,
      targets: selectedTargets,
      repeatCount,
      labels,
    };
  }, [project, name, description, selectedScenarioIds, selectedTargets, repeatCount, labels]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    const data = buildFormData();
    if (!data) return;

    if (isEditMode && suite) {
      updateMutation.mutate({ ...data, id: suite.id });
    } else {
      createMutation.mutate(data);
    }
  }, [validate, buildFormData, isEditMode, suite, createMutation, updateMutation]);

  const handleRunNow = useCallback(async () => {
    if (!validate()) return;
    const data = buildFormData();
    if (!data) return;

    const onSuccess = (saved: SimulationSuiteConfiguration) => {
      runMutation.mutate({ projectId: data.projectId, id: saved.id });
      onRan?.(saved.id);
    };

    if (isEditMode && suite) {
      updateMutation.mutate({ ...data, id: suite.id }, { onSuccess });
    } else {
      createMutation.mutate(data, { onSuccess });
    }
  }, [validate, buildFormData, isEditMode, suite, createMutation, updateMutation, runMutation, onRan]);

  const toggleScenario = (id: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const toggleTarget = (target: SuiteTarget) => {
    setSelectedTargets((prev) => {
      const exists = prev.some(
        (t) => t.type === target.type && t.referenceId === target.referenceId,
      );
      if (exists) {
        return prev.filter(
          (t) =>
            !(t.type === target.type && t.referenceId === target.referenceId),
        );
      }
      return [...prev, target];
    });
  };

  const isTargetSelected = (type: string, referenceId: string) =>
    selectedTargets.some(
      (t) => t.type === type && t.referenceId === referenceId,
    );

  const selectAllScenarios = () => {
    if (filteredScenarios) {
      setSelectedScenarioIds(filteredScenarios.map((s) => s.id));
    }
  };

  const clearScenarios = () => {
    setSelectedScenarioIds([]);
  };

  const isSaving =
    createMutation.isPending || updateMutation.isPending;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="end"
      size="lg"
    >
      <Drawer.Backdrop />
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                borderColor={errors.name ? "red.500" : undefined}
              />
              {errors.name && (
                <Text fontSize="xs" color="red.500">
                  {errors.name}
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
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </VStack>

            {/* Labels */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Labels
              </Text>
              <HStack gap={1} flexWrap="wrap">
                {labels.map((label) => (
                  <Badge
                    key={label}
                    size="sm"
                    variant="outline"
                    cursor="pointer"
                    onClick={() =>
                      setLabels((prev) => prev.filter((l) => l !== label))
                    }
                  >
                    {label} x
                  </Badge>
                ))}
                <Input
                  size="sm"
                  placeholder="+ add"
                  width="80px"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = e.currentTarget.value.trim();
                      if (val && !labels.includes(val)) {
                        setLabels((prev) => [...prev, val]);
                      }
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </HStack>
            </VStack>

            {/* Scenarios */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Scenarios *
              </Text>
              <Box
                border="1px solid"
                borderColor={errors.scenarios ? "red.500" : "border"}
                borderRadius="md"
                width="full"
              >
                <Box paddingX={3} paddingY={2}>
                  <Input
                    size="sm"
                    placeholder="Search scenarios..."
                    value={scenarioSearch}
                    onChange={(e) => setScenarioSearch(e.target.value)}
                  />
                </Box>

                {/* Label filter chips */}
                {allLabels.length > 0 && (
                  <HStack paddingX={3} paddingBottom={2} gap={1} flexWrap="wrap">
                    <Badge
                      size="sm"
                      cursor="pointer"
                      variant={activeLabelFilter === null ? "solid" : "outline"}
                      onClick={() => setActiveLabelFilter(null)}
                    >
                      All
                    </Badge>
                    {allLabels.map((label) => (
                      <Badge
                        key={label}
                        size="sm"
                        cursor="pointer"
                        variant={
                          activeLabelFilter === label ? "solid" : "outline"
                        }
                        onClick={() =>
                          setActiveLabelFilter(
                            activeLabelFilter === label ? null : label,
                          )
                        }
                      >
                        #{label}
                      </Badge>
                    ))}
                  </HStack>
                )}

                {/* Scenario list */}
                <VStack
                  maxHeight="200px"
                  overflow="auto"
                  paddingX={3}
                  gap={1}
                  align="stretch"
                >
                  {filteredScenarios?.map((scenario) => (
                    <HStack
                      key={scenario.id}
                      gap={2}
                      paddingY={1}
                      cursor="pointer"
                      onClick={() => toggleScenario(scenario.id)}
                    >
                      <Checkbox
                        checked={selectedScenarioIds.includes(scenario.id)}
                        onCheckedChange={() => toggleScenario(scenario.id)}
                      />
                      <Text fontSize="sm" flex={1}>
                        {scenario.name}
                      </Text>
                      {scenario.labels.map((l) => (
                        <Badge key={l} size="sm" variant="outline">
                          #{l}
                        </Badge>
                      ))}
                    </HStack>
                  ))}
                </VStack>

                {/* Footer with count + select all / clear */}
                <HStack
                  paddingX={3}
                  paddingY={2}
                  justify="space-between"
                  borderTop="1px solid"
                  borderColor="border"
                >
                  <Text fontSize="xs" color="fg.muted">
                    {selectedScenarioIds.length} of{" "}
                    {scenarios?.length ?? 0} selected
                  </Text>
                  <HStack gap={2}>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={selectAllScenarios}
                    >
                      Select All
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={clearScenarios}
                    >
                      Clear
                    </Button>
                  </HStack>
                </HStack>
              </Box>
              {errors.scenarios && (
                <Text fontSize="xs" color="red.500">
                  {errors.scenarios}
                </Text>
              )}
            </VStack>

            {/* Targets */}
            <VStack align="start" gap={1}>
              <Text fontSize="sm" fontWeight="medium">
                Target(s) *
              </Text>
              <Box
                border="1px solid"
                borderColor={errors.targets ? "red.500" : "border"}
                borderRadius="md"
                width="full"
              >
                <Box paddingX={3} paddingY={2}>
                  <Input
                    size="sm"
                    placeholder="Search targets..."
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                  />
                </Box>

                <VStack
                  maxHeight="200px"
                  overflow="auto"
                  paddingX={3}
                  gap={1}
                  align="stretch"
                >
                  {filteredTargets.map((target) => (
                    <HStack
                      key={`${target.type}-${target.referenceId}`}
                      gap={2}
                      paddingY={1}
                      cursor="pointer"
                      onClick={() =>
                        toggleTarget({
                          type: target.type,
                          referenceId: target.referenceId,
                        })
                      }
                    >
                      <Checkbox
                        checked={isTargetSelected(
                          target.type,
                          target.referenceId,
                        )}
                        onCheckedChange={() =>
                          toggleTarget({
                            type: target.type,
                            referenceId: target.referenceId,
                          })
                        }
                      />
                      <Text fontSize="sm" flex={1}>
                        {target.name}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        ({target.type === "http" ? "HTTP" : "Prompt"})
                      </Text>
                    </HStack>
                  ))}
                  {filteredTargets.length === 0 && (
                    <Text fontSize="sm" color="fg.muted" paddingY={2}>
                      No targets available
                    </Text>
                  )}
                </VStack>

                <HStack
                  paddingX={3}
                  paddingY={2}
                  borderTop="1px solid"
                  borderColor="border"
                >
                  <Text fontSize="xs" color="fg.muted">
                    {selectedTargets.length} of{" "}
                    {availableTargets.length} selected
                  </Text>
                </HStack>
              </Box>
              {errors.targets && (
                <Text fontSize="xs" color="red.500">
                  {errors.targets}
                </Text>
              )}
            </VStack>

            {/* Execution Options */}
            <Collapsible.Root
              open={executionOptionsOpen}
              onOpenChange={(d) => setExecutionOptionsOpen(d.open)}
            >
              <Collapsible.Trigger asChild>
                <HStack cursor="pointer" gap={2}>
                  {executionOptionsOpen ? (
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
                  <HStack gap={2} align="center">
                    <Text fontSize="sm">Repeat count</Text>
                    <Input
                      type="number"
                      size="sm"
                      width="80px"
                      min={1}
                      value={repeatCount}
                      onChange={(e) =>
                        setRepeatCount(Math.max(1, parseInt(e.target.value) || 1))
                      }
                    />
                    <Text fontSize="xs" color="fg.muted">
                      times per scenario x target
                    </Text>
                  </HStack>
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
            <Button
              variant="outline"
              onClick={handleSave}
              loading={isSaving}
            >
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
