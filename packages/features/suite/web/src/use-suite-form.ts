import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { FieldMapping } from "@langwatch/scenario-contract";
import { suiteTargetSchema, type SuiteTarget } from "@langwatch/suite-contract";

import {
  filterScenarios,
  filterTargets,
  getAllLabels,
  getArchivedScenarioIds,
  getArchivedTargets,
  getAvailableTargets,
  isSameTarget,
  withTargetMapping,
} from "./suite-form-derivations";
import {
  suiteFormDefaultValues,
  suiteFormSchema,
  type SuiteFormData,
  type UseSuiteFormParams,
} from "./suite-form.types";

export { MAX_REPEAT_COUNT, suiteFormSchema } from "./suite-form.types";
export type {
  SuiteFormAgent,
  SuiteFormAvailableTarget,
  SuiteFormData,
  SuiteFormPrompt,
  SuiteFormScenario,
  SuiteFormSuite,
  UseSuiteFormParams,
} from "./suite-form.types";

export function useSuiteForm({
  suite,
  isOpen,
  suiteId,
  scenarios,
  agents,
  prompts,
}: UseSuiteFormParams) {
  const form = useForm<SuiteFormData>({
    defaultValues: suiteFormDefaultValues,
    resolver: zodResolver(suiteFormSchema),
    mode: "onSubmit",
  });

  const [executionOptionsOpen, setExecutionOptionsOpen] = useState(false);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [activeLabelFilter, setActiveLabelFilter] = useState<string | null>(null);

  const selectedScenarioIds = form.watch("selectedScenarioIds");
  const selectedTargets = form.watch("selectedTargets");
  const labels = form.watch("labels");
  const simulatorModel = form.watch("simulatorModel");
  const judgeModel = form.watch("judgeModel");

  const availableTargets = useMemo(
    () => getAvailableTargets(agents, prompts),
    [agents, prompts],
  );

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

  useEffect(() => {
    if (suite && isOpen) {
      form.reset({
        name: suite.name,
        description: suite.description ?? "",
        labels: suite.labels,
        selectedScenarioIds: suite.scenarioIds,
        selectedTargets: z.array(suiteTargetSchema).parse(suite.targets),
        repeatCount: suite.repeatCount,
        simulatorModel: suite.simulatorModel,
        judgeModel: suite.judgeModel,
      });
    } else if (isOpen) {
      form.reset(suiteFormDefaultValues);
      setScenarioSearch("");
      setTargetSearch("");
      setActiveLabelFilter(null);
    }
    // Keyed on suite.id to avoid an infinite loop from an unstable suite reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suite?.id, suiteId, isOpen]);

  const toggleScenario = (id: string) => {
    const current = form.getValues("selectedScenarioIds");
    const next = current.includes(id)
      ? current.filter((scenarioId) => scenarioId !== id)
      : [...current, id];
    form.setValue("selectedScenarioIds", next);
  };

  const toggleTarget = (target: SuiteTarget) => {
    const current = form.getValues("selectedTargets");
    const exists = current.some((candidate) => isSameTarget(candidate, target));
    const next = exists
      ? current.filter((candidate) => !isSameTarget(candidate, target))
      : [...current, target];
    form.setValue("selectedTargets", next);
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
      (target) => target.type === type && target.referenceId === referenceId,
    );

  const selectAllTargets = () => {
    const current = form.getValues("selectedTargets");
    const currentKeys = new Set(
      current.map((target) => `${target.type}:${target.referenceId}`),
    );
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
      const merged = new Set([
        ...current,
        ...filteredScenarios.map((scenario) => scenario.id),
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
