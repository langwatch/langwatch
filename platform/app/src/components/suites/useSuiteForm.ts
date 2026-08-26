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
import type { FieldMapping } from "~/components/variables/VariableMappingInput";
import type { SimulationSuite } from "~/generated/prisma/client";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import {
  CASES_SCOPE,
  parseSuiteScope,
  type SuiteScope,
  type SuiteScopeMode,
  suiteScopeSchema,
} from "~/server/suites/scope";
import {
  parseSuiteTargets,
  type SuiteTarget,
  suiteTargetSchema,
} from "~/server/suites/types";

const scenarioIdsField = z.array(z.string());

export const suiteFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  labels: z.array(z.string()),
  scope: suiteScopeSchema,
  selectedScenarioIds: scenarioIdsField.min(
    1,
    "At least one scenario is required",
  ),
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
  // null = follow the project default (scenarios.user_simulator /
  // scenarios.judge); a string pins the model for the whole run plan.
  simulatorModel: z.string().nullable(),
  judgeModel: z.string().nullable(),
});

export type SuiteFormData = z.infer<typeof suiteFormSchema>;

/**
 * The rules the Agent Testing run plan editor holds the same form to.
 *
 * It asks for no target: the run dialog is where an agent or a prompt is
 * chosen. It asks for a case list only from a plan that runs one, and for a
 * suite or label scope it asks that the scope name something.
 */
export const planFormSchema = suiteFormSchema
  .extend({
    selectedScenarioIds: scenarioIdsField,
    selectedTargets: z.array(suiteTargetSchema),
  })
  .superRefine((data, ctx) => {
    const empty =
      (data.scope.mode === "cases" && data.selectedScenarioIds.length === 0) ||
      (data.scope.mode === "folders" && data.scope.folderIds.length === 0) ||
      (data.scope.mode === "labels" && data.scope.labels.length === 0);
    if (empty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "This plan covers no test case yet",
      });
    }
  });

interface Scenario {
  id: string;
  name: string;
  labels: string[];
  /** The test suite the case is filed in, when the project uses them. */
  folderId?: string | null;
}

interface Agent {
  id: string;
  name: string;
  type: string;
}

interface Prompt {
  id: string;
  handle?: string | null;
}

interface AvailableTarget {
  name: string;
  type: "http" | "prompt" | "code" | "workflow";
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
  /**
   * True when this form is where the run's targets are chosen, which the v1
   * suite drawer is and the Agent Testing plan editor is not.
   */
  picksTargets?: boolean;
  /** What a plan written in this form covers before anything is picked. */
  defaultScope?: SuiteScope;
}

const isSameTarget = (a: SuiteTarget, b: SuiteTarget) =>
  a.type === b.type && a.referenceId === b.referenceId;

/** One target with a single mapping set (or cleared, for an undefined mapping). */
function withTargetMapping({
  target,
  identifier,
  mapping,
}: {
  target: SuiteTarget;
  identifier: string;
  mapping: FieldMapping | undefined;
}): SuiteTarget {
  const mappings = { ...(target.scenarioMappings ?? {}) };
  if (mapping) {
    mappings[identifier] = mapping;
  } else {
    delete mappings[identifier];
  }
  return {
    ...target,
    scenarioMappings: Object.keys(mappings).length > 0 ? mappings : undefined,
  };
}

/** What each dynamic mode of a stored scope holds, both read at once. */
function rememberedLists(scope: SuiteScope): {
  folderIds: string[];
  labels: string[];
} {
  return {
    folderIds: scope.mode === "folders" ? scope.folderIds : [],
    labels: scope.mode === "labels" ? scope.labels : [],
  };
}

const defaultValues: SuiteFormData = {
  name: "",
  description: "",
  labels: [],
  scope: CASES_SCOPE,
  selectedScenarioIds: [],
  selectedTargets: [],
  repeatCount: 1,
  simulatorModel: null,
  judgeModel: null,
};

export function useSuiteForm({
  suite,
  isOpen,
  suiteId,
  scenarios,
  agents,
  prompts,
  picksTargets = true,
  defaultScope = CASES_SCOPE,
}: UseSuiteFormParams) {
  const form = useForm<SuiteFormData>({
    defaultValues: { ...defaultValues, scope: defaultScope },
    resolver: zodResolver(picksTargets ? suiteFormSchema : planFormSchema),
    mode: "onSubmit",
  });

  // -- UI state (not form data) --
  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(
    null,
  );
  // What each dynamic mode last held, so switching between modes to compare
  // them does not throw away the ticks just made.
  const [rememberedFolderIds, setRememberedFolderIds] = useState<string[]>([]);
  const [rememberedLabels, setRememberedLabels] = useState<string[]>([]);

  // -- Watch form values for derived state --
  const scope = form.watch("scope");
  const selectedScenarioIds = form.watch("selectedScenarioIds");
  const selectedTargets = form.watch("selectedTargets");
  const labels = form.watch("labels");
  const simulatorModel = form.watch("simulatorModel");
  const judgeModel = form.watch("judgeModel");

  // -- Derived: available targets from agents + prompts --
  const availableTargets = useMemo(() => {
    const result: AvailableTarget[] = [];
    if (agents) {
      for (const agent of agents) {
        // http, code, and workflow agents are supported as suite targets.
        // signature agents are excluded — they're used as sub-components of
        // workflows rather than as stand-alone scenario targets.
        if (
          agent.type !== "http" &&
          agent.type !== "code" &&
          agent.type !== "workflow"
        ) {
          continue;
        }
        result.push({
          name: agent.name,
          type: agent.type,
          referenceId: agent.id,
        });
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

  // -- Derived: archived scenarios (selected but not in active scenarios query) --
  const archivedScenarioIds = useMemo(() => {
    if (!scenarios) return [];
    const activeIds = new Set(scenarios.map((s) => s.id));
    return selectedScenarioIds
      .filter((id) => !activeIds.has(id))
      .map((id) => ({ id, name: id }));
  }, [selectedScenarioIds, scenarios]);

  // -- Derived: archived targets (selected but no longer available, with full type info) --
  const archivedTargets = useMemo(() => {
    if (!agents || !prompts) return [];
    return selectedTargets
      .filter(
        (t) =>
          !availableTargets.some(
            (a) => a.type === t.type && a.referenceId === t.referenceId,
          ),
      )
      .map((t) => ({ ...t, name: t.referenceId }));
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

  /**
   * The cases the scope covers, from the lists the form already holds.
   *
   * The same rule the run resolves against the database, read here against the
   * project's active cases, so the count under the picker is what the run will
   * cover.
   */
  const scopedScenarioIds = useMemo(() => {
    const active = scenarios ?? [];
    if (scope.mode === "all") return active.map((scenario) => scenario.id);
    if (scope.mode === "folders") {
      return active
        .filter(
          (scenario) =>
            !!scenario.folderId && scope.folderIds.includes(scenario.folderId),
        )
        .map((scenario) => scenario.id);
    }
    if (scope.mode === "labels") {
      return active
        .filter((scenario) =>
          scenario.labels.some((label) => scope.labels.includes(label)),
        )
        .map((scenario) => scenario.id);
    }
    return selectedScenarioIds;
  }, [scenarios, scope, selectedScenarioIds]);

  // -- Initialize form for edit mode / reset for create mode --
  useEffect(() => {
    if (suite && isOpen) {
      const storedScope = parseSuiteScope(suite.scope);
      const remembered = rememberedLists(storedScope);
      setRememberedFolderIds(remembered.folderIds);
      setRememberedLabels(remembered.labels);
      form.reset({
        name: suite.name,
        description: suite.description ?? "",
        labels: suite.labels,
        scope: storedScope,
        selectedScenarioIds: suite.scenarioIds,
        selectedTargets: parseSuiteTargets(suite.targets),
        repeatCount: suite.repeatCount,
        simulatorModel: suite.simulatorModel,
        judgeModel: suite.judgeModel,
      });
    } else if (isOpen) {
      form.reset({ ...defaultValues, scope: defaultScope });
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
      setRememberedFolderIds([]);
      setRememberedLabels([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on suite.id to avoid infinite loop from unstable suite reference
  }, [suite?.id, suiteId, isOpen]);

  // -- Actions --

  const writeScope = (next: SuiteScope) => {
    form.setValue("scope", next, { shouldDirty: true });
    form.clearErrors("scope");
  };

  /**
   * Moves the plan to another mode, giving back what that mode last held.
   *
   * The stored shape carries one list per mode, so without the memory a person
   * comparing two modes loses the ticks they just made in the first.
   */
  const setScopeMode = (mode: SuiteScopeMode) => {
    if (mode === "all") return writeScope({ mode });
    if (mode === "cases") return writeScope({ mode });
    if (mode === "folders")
      return writeScope({ mode, folderIds: rememberedFolderIds });
    writeScope({ mode, labels: rememberedLabels });
  };

  const toggleScopeFolder = (folderId: string) => {
    const current = scope.mode === "folders" ? scope.folderIds : [];
    const next = current.includes(folderId)
      ? current.filter((id) => id !== folderId)
      : [...current, folderId];
    setRememberedFolderIds(next);
    writeScope({ mode: "folders", folderIds: next });
  };

  const toggleScopeLabel = (label: string) => {
    const current = scope.mode === "labels" ? scope.labels : [];
    const next = current.includes(label)
      ? current.filter((entry) => entry !== label)
      : [...current, label];
    setRememberedLabels(next);
    writeScope({ mode: "labels", labels: next });
  };

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

  /**
   * Set (or clear) one binding on a selected target.
   *
   * Only prompt targets use this: an agent is configured, so its mappings live
   * on the agent record; a prompt is authored elsewhere and pointed at, so the
   * binding between a simulation and its declared inputs belongs to the run
   * plan that made the pairing.
   */
  const setTargetMapping = ({
    target,
    identifier,
    mapping,
  }: {
    target: SuiteTarget;
    identifier: string;
    mapping: FieldMapping | undefined;
  }) => {
    const next = form
      .getValues("selectedTargets")
      .map((candidate) =>
        isSameTarget(candidate, target)
          ? withTargetMapping({ target: candidate, identifier, mapping })
          : candidate,
      );
    form.setValue("selectedTargets", next, { shouldDirty: true });
  };

  const isTargetSelected = (type: string, referenceId: string) =>
    selectedTargets.some(
      (t) => t.type === type && t.referenceId === referenceId,
    );

  const selectAllTargets = () => {
    const current = form.getValues("selectedTargets");
    const currentKeys = new Set(
      current.map((t) => `${t.type}:${t.referenceId}`),
    );
    const newTargets = filteredTargets
      .filter((t) => !currentKeys.has(`${t.type}:${t.referenceId}`))
      .map((t) => ({ type: t.type, referenceId: t.referenceId }));
    form.setValue("selectedTargets", [...current, ...newTargets], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  // Clears all targets regardless of filter (matches ScenarioPicker behavior)
  const clearTargets = () => {
    form.setValue("selectedTargets", [], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

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

  const removeArchivedScenario = (id: string) => {
    const current = form.getValues("selectedScenarioIds");
    form.setValue(
      "selectedScenarioIds",
      current.filter((s) => s !== id),
    );
  };

  const removeArchivedTarget = (
    target: Pick<SuiteTarget, "type" | "referenceId">,
  ) => {
    const current = form.getValues("selectedTargets");
    form.setValue(
      "selectedTargets",
      current.filter(
        (t) =>
          !(t.type === target.type && t.referenceId === target.referenceId),
      ),
    );
  };

  return {
    // react-hook-form instance
    form,

    // Form field values (watched)
    labels,
    scope,
    setScopeMode,
    toggleScopeFolder,
    toggleScopeLabel,
    /** The cases the scope covers right now, from the loaded lists. */
    scopedScenarioIds,
    selectedScenarioIds,
    selectedTargets,
    simulatorModel,
    judgeModel,
    setSimulatorModel: (value: string | null) =>
      form.setValue("simulatorModel", value, { shouldDirty: true }),
    setJudgeModel: (value: string | null) =>
      form.setValue("judgeModel", value, { shouldDirty: true }),

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
    setTargetMapping,
    selectAllTargets,
    clearTargets,
    isTargetSelected,

    // Archived references
    archivedScenarioIds,
    archivedTargets,
    removeArchivedScenario,
    removeArchivedTarget,

    // Actions
    addLabel,
    removeLabel,
  };
}
