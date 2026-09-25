import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldMapping } from "@langwatch/scenario-contract";
import {
  SCENARIOS_SCOPE,
  parseSuiteScope,
  type SuiteScope,
  type SuiteScopeMode,
  suiteScopeSchema,
  type SuiteTarget,
  suiteTargetSchema,
} from "@langwatch/suite-contract";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  filterScenarios,
  filterTargets,
  getAllLabels,
  getArchivedScenarioIds,
  getArchivedTargets,
  getAvailableTargets,
  isSameTarget,
  rememberedScopeOf,
  scopeForMode,
  scopedScenarioIdsOf,
  suiteFormValuesOf,
  targetsWithMapping,
  toggledTarget,
  toggledValue,
} from "../model/suite-form-derivations.ts";
import {
  planFormSchema,
  suiteFormDefaultValues,
  suiteFormSchema,
  type SuiteFormData,
  type UseSuiteFormParams,
} from "../model/suite-form.types.ts";

export { MAX_REPEAT_COUNT, planFormSchema, suiteFormSchema } from "../model/suite-form.types.ts";
export type {
  SuiteFormAgent,
  SuiteFormAvailableTarget,
  SuiteFormData,
  SuiteFormPrompt,
  SuiteFormReturn,
  SuiteFormScenario,
  SuiteFormSuite,
  UseSuiteFormParams,
} from "../model/suite-form.types.ts";

export function useSuiteForm({
  suite,
  isOpen,
  suiteId,
  scenarios,
  agents,
  prompts,
  picksTargets = true,
  defaultScope = SCENARIOS_SCOPE,
}: UseSuiteFormParams) {
  const form = useForm<z.input<typeof suiteFormSchema>, unknown, SuiteFormData>({
    defaultValues: { ...suiteFormDefaultValues, scope: defaultScope },
    // The run plan editor picks no target and may cover its scenarios dynamically,
    // so it is held to the plan rules rather than the suite ones.
    resolver: zodResolver(picksTargets ? suiteFormSchema : planFormSchema),
    mode: "onSubmit",
  });

  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(null);
  // One list per dynamic mode, so somebody comparing two modes does not lose
  // the ticks they just made in the first. The stored shape holds only the
  // mode in force, so the memory has to live here.
  const [rememberedTestSuiteIds, setRememberedTestSuiteIds] = useState<string[]>([]);
  const [rememberedLabels, setRememberedLabels] = useState<string[]>([]);

  const selectedScenarioIds = form.watch("selectedScenarioIds");
  const selectedTargets = z.array(suiteTargetSchema).parse(form.watch("selectedTargets"));
  const labels = form.watch("labels");
  const scope = suiteScopeSchema.parse(form.watch("scope"));
  const simulatorModel = form.watch("simulatorModel");
  const judgeModel = form.watch("judgeModel");

  const availableTargets = useMemo(() => getAvailableTargets(agents, prompts), [agents, prompts]);

  const archivedScenarioIds = useMemo(
    () => getArchivedScenarioIds(selectedScenarioIds, scenarios),
    [selectedScenarioIds, scenarios],
  );

  const archivedTargets = useMemo(
    () => getArchivedTargets(selectedTargets, availableTargets, agents, prompts),
    [selectedTargets, availableTargets, agents, prompts],
  );

  const allLabels = useMemo(() => getAllLabels(scenarios), [scenarios]);

  const filteredScenarios = useMemo(
    () => filterScenarios(scenarios, scenarioSearch, activeLabelFilter),
    [scenarios, scenarioSearch, activeLabelFilter],
  );

  const filteredTargets = useMemo(
    () => filterTargets(availableTargets, targetSearch),
    [availableTargets, targetSearch],
  );

  const scopedScenarioIds = useMemo(
    () => scopedScenarioIdsOf({ scenarios, scope, selectedScenarioIds }),
    [scenarios, scope, selectedScenarioIds],
  );

  useEffect(() => {
    if (suite && isOpen) {
      const storedScope = parseSuiteScope(suite.scope);
      const remembered = rememberedScopeOf(storedScope);
      setRememberedTestSuiteIds(remembered.testSuiteIds);
      setRememberedLabels(remembered.labels);
      form.reset(suiteFormValuesOf({ suite, scope: storedScope }));
    } else if (isOpen) {
      form.reset({ ...suiteFormDefaultValues, scope: defaultScope });
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
      setRememberedTestSuiteIds([]);
      setRememberedLabels([]);
    }
    // Keyed on suite.id to avoid an infinite loop from an unstable suite reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suite?.id, suiteId, isOpen]);

  const writeScope = (next: SuiteScope) => {
    form.setValue("scope", next, { shouldDirty: true });
    form.clearErrors("scope");
  };

  /** Moves the plan to another mode, giving back what that mode last held. */
  const setScopeMode = (mode: SuiteScopeMode) =>
    writeScope(scopeForMode({ mode, rememberedTestSuiteIds, rememberedLabels }));

  const toggleScopeTestSuite = (testSuiteId: string) => {
    const current = scope.mode === "test_suites" ? scope.testSuiteIds : [];
    const next = toggledValue(current, testSuiteId);
    setRememberedTestSuiteIds(next);
    writeScope({ mode: "test_suites", testSuiteIds: next });
  };

  const toggleScopeLabel = (label: string) => {
    const current = scope.mode === "labels" ? scope.labels : [];
    const next = toggledValue(current, label);
    setRememberedLabels(next);
    writeScope({ mode: "labels", labels: next });
  };

  const toggleScenario = (id: string) => {
    form.setValue("selectedScenarioIds", toggledValue(form.getValues("selectedScenarioIds"), id));
  };

  const toggleTarget = (target: SuiteTarget) => {
    form.setValue("selectedTargets", toggledTarget(form.getValues("selectedTargets"), target));
  };

  const setTargetMapping = ({
    target,
    identifier,
    mapping,
  }: {
    target: SuiteTarget;
    identifier: string;
    mapping: FieldMapping | undefined;
  }) => {
    const next = targetsWithMapping({ targets: selectedTargets, target, identifier, mapping });
    form.setValue("selectedTargets", next, { shouldDirty: true });
  };

  const isTargetSelected = (type: string, referenceId: string) =>
    selectedTargets.some((target) => target.type === type && target.referenceId === referenceId);

  const selectAllTargets = () => {
    const current = form.getValues("selectedTargets");
    const currentKeys = new Set(current.map((target) => `${target.type}:${target.referenceId}`));
    const newTargets = filteredTargets
      .filter((target) => !currentKeys.has(`${target.type}:${target.referenceId}`))
      .map((target) => ({ type: target.type, referenceId: target.referenceId }));
    form.setValue("selectedTargets", [...current, ...newTargets], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const clearTargets = () => {
    form.setValue("selectedTargets", [], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const selectAllScenarios = () => {
    if (filteredScenarios) {
      const current = form.getValues("selectedScenarioIds");
      const merged = new Set([...current, ...filteredScenarios.map((scenario) => scenario.id)]);
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
      current.filter((currentLabel) => currentLabel !== label),
    );
  };

  const removeArchivedScenario = (id: string) => {
    const current = form.getValues("selectedScenarioIds");
    form.setValue(
      "selectedScenarioIds",
      current.filter((scenarioId) => scenarioId !== id),
    );
  };

  const removeArchivedTarget = (target: Pick<SuiteTarget, "type" | "referenceId">) => {
    const current = form.getValues("selectedTargets");
    form.setValue(
      "selectedTargets",
      current.filter((candidate) => !isSameTarget(candidate, target)),
    );
  };

  return {
    form,
    labels,
    scope,
    scopedScenarioIds,
    setScopeMode,
    toggleScopeTestSuite,
    toggleScopeLabel,
    selectedScenarioIds,
    selectedTargets,
    simulatorModel,
    judgeModel,
    setSimulatorModel: (value: string | null) =>
      form.setValue("simulatorModel", value, { shouldDirty: true }),
    setJudgeModel: (value: string | null) =>
      form.setValue("judgeModel", value, { shouldDirty: true }),
    executionOptionsOpen,
    setExecutionOptionsOpen,
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
    targetSearch,
    setTargetSearch,
    availableTargets,
    filteredTargets,
    toggleTarget,
    setTargetMapping,
    selectAllTargets,
    clearTargets,
    isTargetSelected,
    archivedScenarioIds,
    archivedTargets,
    removeArchivedScenario,
    removeArchivedTarget,
    addLabel,
    removeLabel,
  };
}
