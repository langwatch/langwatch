/**
 * Custom hook encapsulating all form state and logic for suite creation/editing.
 *
 * Uses react-hook-form + Zod validation, following the ScenarioForm pattern.
 * Error dismissal on typing is handled natively by react-hook-form's
 * default reValidateMode ("onChange"), which re-checks fields on change
 * after the first failed submit.
 *
 * Separated from SuiteFormDrawer to keep the drawer a thin UI orchestrator.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import {
  parseSuiteTargets,
  suiteTargetSchema,
  type SuiteTarget,
} from "~/server/suites/types";
import type { SimulationSuite } from "@prisma/client";

export const suiteFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  labels: z.array(z.string()),
  selectedScenarioIds: z
    .array(z.string())
    .min(1, "At least one scenario is required"),
  selectedTargets: z
    .array(suiteTargetSchema)
    .min(1, "At least one target is required"),
  repeatCount: z.coerce
    .number()
    .int()
    .min(1, `Repeat count must be between 1 and ${MAX_REPEAT_COUNT}`)
    .max(
      MAX_REPEAT_COUNT,
      `Repeat count must be between 1 and ${MAX_REPEAT_COUNT}`,
    ),
});

export type SuiteFormData = z.infer<typeof suiteFormSchema>;

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
  suite: SimulationSuite | null | undefined;
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

const defaultValues: SuiteFormData = {
  name: "",
  description: "",
  labels: [],
  selectedScenarioIds: [],
  selectedTargets: [],
  repeatCount: 1,
};

export function useSuiteForm({
  suite,
  isOpen,
  suiteId,
  scenarios,
  agents,
  prompts,
}: UseSuiteFormParams) {
  const form = useForm<SuiteFormData>({
    defaultValues,
    resolver: zodResolver(suiteFormSchema),
    mode: "onSubmit",
  });

  // -- UI state (not form data) --
  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(
    null,
  );

  // -- Watch form values for derived state --
  const selectedScenarioIds = form.watch("selectedScenarioIds");
  const selectedTargets = form.watch("selectedTargets");
  const labels = form.watch("labels");

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

  // -- Derived: stale target references (selected but no longer available) --
  const staleTargetIds = useMemo(() => {
    if (!agents || !prompts) return [];
    return selectedTargets
      .filter(
        (t) =>
          !availableTargets.some(
            (a) => a.type === t.type && a.referenceId === t.referenceId,
          ),
      )
      .map((t) => t.referenceId);
  }, [selectedTargets, availableTargets, agents, prompts]);

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
      form.reset({
        name: suite.name,
        description: suite.description ?? "",
        labels: suite.labels,
        selectedScenarioIds: suite.scenarioIds,
        selectedTargets: parseSuiteTargets(suite.targets),
        repeatCount: suite.repeatCount,
      });
    } else if (isOpen) {
      form.reset(defaultValues);
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on suite.id to avoid infinite loop from unstable suite reference
  }, [suite?.id, suiteId, isOpen]);

  // -- Actions --

  const toggleScenario = (id: string) => {
    const current = form.getValues("selectedScenarioIds");
    const next = current.includes(id)
      ? current.filter((s) => s !== id)
      : [...current, id];
    form.setValue("selectedScenarioIds", next);
  };

  const toggleTarget = (target: SuiteTarget) => {
    const current = form.getValues("selectedTargets");
    const exists = current.some(
      (t) => t.type === target.type && t.referenceId === target.referenceId,
    );
    const next = exists
      ? current.filter(
          (t) =>
            !(t.type === target.type && t.referenceId === target.referenceId),
        )
      : [...current, target];
    form.setValue("selectedTargets", next);
  };

  const isTargetSelected = (type: string, referenceId: string) =>
    selectedTargets.some(
      (t) => t.type === type && t.referenceId === referenceId,
    );

  const selectAllScenarios = () => {
    if (filteredScenarios) {
      const current = form.getValues("selectedScenarioIds");
      const merged = new Set([
        ...current,
        ...filteredScenarios.map((s) => s.id),
      ]);
      form.setValue("selectedScenarioIds", Array.from(merged));
    }
  };

  const clearScenarios = () => {
    form.setValue("selectedScenarioIds", []);
  };

  const addLabel = (label: string) => {
    const current = form.getValues("labels");
    if (label && !current.includes(label)) {
      form.setValue("labels", [...current, label]);
    }
  };

  const removeLabel = (label: string) => {
    const current = form.getValues("labels");
    form.setValue(
      "labels",
      current.filter((l) => l !== label),
    );
  };

  return {
    // react-hook-form instance
    form,

    // Form field values (watched)
    labels,
    selectedScenarioIds,
    selectedTargets,

    // UI state
    executionOptionsOpen,
    setExecutionOptionsOpen,

    // Scenario state
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
    targetSearch,
    setTargetSearch,
    availableTargets,
    filteredTargets,
    toggleTarget,
    isTargetSelected,
    staleTargetIds,

    // Actions
    addLabel,
    removeLabel,
  };
}
