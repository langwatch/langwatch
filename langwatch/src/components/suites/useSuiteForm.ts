/**
 * Custom hook encapsulating all form state and logic for suite creation/editing.
 *
 * Manages: form fields, search/filter state, validation, derived lists,
 * toggle/select actions, and initialization from existing suite data.
 *
 * Separated from SuiteFormDrawer to keep the drawer a thin UI orchestrator.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseSuiteTargets, type SuiteTarget } from "~/server/suites/types";
import type { SimulationSuiteConfiguration } from "@prisma/client";

interface Scenario {
  id: string;
  name: string;
  labels: string[];
}

interface Agent {
  id: string;
  name: string;
}

interface Prompt {
  id: string;
  handle?: string | null;
}

interface AvailableTarget {
  name: string;
  type: "http" | "prompt";
  referenceId: string;
}

interface UseSuiteFormParams {
  /** Suite data for edit mode (null for create mode). */
  suite: SimulationSuiteConfiguration | null | undefined;
  /** Whether the drawer is currently open. */
  isOpen: boolean;
  /** Suite ID from drawer params (present in edit mode). */
  suiteId: string | undefined;
  /** Available scenarios from the project. */
  scenarios: Scenario[] | undefined;
  /** Available agents from the project. */
  agents: Agent[] | undefined;
  /** Available prompts from the project. */
  prompts: Prompt[] | undefined;
}

export function useSuiteForm({
  suite,
  isOpen,
  suiteId,
  scenarios,
  agents,
  prompts,
}: UseSuiteFormParams) {
  // -- Form state --
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<SuiteTarget[]>([]);
  const [repeatCountStr, setRepeatCountStr] = useState("1");
  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);

  // -- Search state --
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(
    null,
  );

  // -- Validation state --
  const [errors, setErrors] = useState<Record<string, string>>({});

  // -- Derived: available targets from agents + prompts --
  const availableTargets = useMemo(() => {
    const result: AvailableTarget[] = [];
    if (agents) {
      for (const agent of agents) {
        result.push({ name: agent.name, type: "http", referenceId: agent.id });
      }
    }
    if (prompts) {
      for (const prompt of prompts) {
        result.push({
          name: prompt.handle ?? prompt.id,
          type: "prompt",
          referenceId: prompt.id,
        });
      }
    }
    return result;
  }, [agents, prompts]);

  // -- Derived: unique scenario labels --
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

  // -- Derived: filtered scenarios --
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

  // -- Derived: filtered targets --
  const filteredTargets = useMemo(() => {
    if (!targetSearch.trim()) return availableTargets;
    const q = targetSearch.toLowerCase();
    return availableTargets.filter((t) => t.name.toLowerCase().includes(q));
  }, [availableTargets, targetSearch]);

  // -- Initialize form for edit mode / reset for create mode --
  useEffect(() => {
    if (suite && isOpen) {
      setName(suite.name);
      setDescription(suite.description ?? "");
      setLabels(suite.labels);
      setSelectedScenarioIds(suite.scenarioIds);
      setSelectedTargets(parseSuiteTargets(suite.targets));
      setRepeatCountStr(String(suite.repeatCount));
      setErrors({});
    } else if (!suiteId && isOpen) {
      setName("");
      setDescription("");
      setLabels([]);
      setSelectedScenarioIds([]);
      setSelectedTargets([]);
      setRepeatCountStr("1");
      setErrors({});
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
    }
  }, [suite, suiteId, isOpen]);

  // -- Actions --

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

  const addLabel = (label: string) => {
    if (label && !labels.includes(label)) {
      setLabels((prev) => [...prev, label]);
    }
  };

  const removeLabel = (label: string) => {
    setLabels((prev) => prev.filter((l) => l !== label));
  };

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

  const buildFormData = useCallback(
    ({ projectId }: { projectId: string }) => {
      const repeatCount = Math.max(1, parseInt(repeatCountStr, 10) || 1);
      return {
        projectId,
        name: name.trim(),
        description: description.trim() || undefined,
        scenarioIds: selectedScenarioIds,
        targets: selectedTargets,
        repeatCount,
        labels,
      };
    },
    [name, description, selectedScenarioIds, selectedTargets, repeatCountStr, labels],
  );

  return {
    // Form fields
    name,
    setName,
    description,
    setDescription,
    labels,
    setLabels,
    addLabel,
    removeLabel,
    repeatCountStr,
    setRepeatCountStr,
    executionOptionsOpen,
    setExecutionOptionsOpen,

    // Scenario state
    selectedScenarioIds,
    scenarioSearch,
    setScenarioSearch,
    activeLabelFilter,
    setActiveLabelFilter,
    allLabels,
    filteredScenarios,
    toggleScenario,
    selectAllScenarios,
    clearScenarios,
    totalScenarioCount: scenarios?.length ?? 0,

    // Target state
    selectedTargets,
    targetSearch,
    setTargetSearch,
    availableTargets,
    filteredTargets,
    toggleTarget,
    isTargetSelected,

    // Validation
    errors,
    validate,

    // Form data builder
    buildFormData,
  };
}
