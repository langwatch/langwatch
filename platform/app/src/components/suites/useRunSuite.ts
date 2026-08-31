/**
 * Headless hook for running a suite with confirmation state management.
 *
 * Manages: confirmation dialog state, the run mutation, and toast handling.
 * The consumer is responsible for rendering the confirmation dialog using
 * the returned state props.
 */

import { generate } from "@langwatch/ksuid";
import { useCallback, useMemo, useRef, useState } from "react";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  parseScenarioParameterDefinitions,
  type RunParameterValues,
  type ScenarioParameterDefinition,
} from "~/server/scenarios/parameters";
import { targetLabelOf } from "~/server/suites/target-key";
import { parseSuiteTargets } from "~/server/suites/types";
import { api } from "~/utils/api";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  displayTypedValue,
  serializeOptionalTypedScalarValue,
} from "~/utils/jsonValueText";
import { toaster } from "../ui/toaster";
import { showSuiteRunError } from "./showSuiteRunError";

export interface UseRunSuiteOptions {
  onRunScheduled?: (suiteId: string, batchRunId: string) => void;
  /**
   * Invoked when the user clicks the "View run" action on the run-scheduled
   * success toast. The consumer decides where to navigate (e.g. the run plan
   * detail page). When omitted, the success toast carries no action — the hook
   * never navigates on its own.
   */
  onViewRun?: (suiteId: string) => void;
}

/** Where a declared parameter comes from. */
export type ParameterSource = "scenario" | "agent";

/**
 * One parameter a run can carry, with where it is declared: on a scenario of
 * the run, or by an agent the run goes against.
 */
export type DeclaredParameter = ScenarioParameterDefinition & {
  source: ParameterSource;
  /** The label of the agent that declares it. Nothing for a scenario one. */
  agentLabel?: string;
};

/** An agent of the run, with the parameters it declares. */
export type ParameterDeclaringAgent = {
  id: string;
  name: string;
  environment?: string | null;
  owner?: { name: string | null } | null;
  parameters?: readonly ScenarioParameterDefinition[];
};

/**
 * The parameters the scenarios of the run declare, keyed by name.
 *
 * Two scenarios can declare the same name and only one of them describe it or
 * default it, so a name keeps the first description and the first default any
 * of them gives it rather than the last one read.
 *
 * Secret is the one field that is not first-wins: a name any scenario in the
 * run declares secret is offered as secret. The run refuses that pair anyway,
 * and asking for the value behind a password field is what lets the person see
 * the conflict instead of typing a credential into a plain field first.
 */
function scenarioDeclaredParameters({
  scenarioIds,
  scenarios,
}: {
  scenarioIds: string[];
  scenarios: readonly { id: string; parameters: unknown }[];
}): Map<string, DeclaredParameter> {
  const inRun = new Set(scenarioIds);
  const declared = scenarios
    .filter((scenario) => inRun.has(scenario.id))
    .flatMap((scenario) =>
      parseScenarioParameterDefinitions(scenario.parameters),
    );

  const union = new Map<string, DeclaredParameter>();
  for (const definition of declared) {
    const seen = union.get(definition.name);
    union.set(definition.name, {
      ...(seen ?? definition),
      name: definition.name,
      description: seen?.description ?? definition.description,
      defaultValue: seen?.defaultValue ?? definition.defaultValue,
      secret: seen?.secret === true || definition.secret === true,
      source: "scenario",
    });
  }
  return union;
}

/** The parameters one agent declares, each tagged with the agent label. */
function agentDeclaredParameters(
  agent: ParameterDeclaringAgent,
): DeclaredParameter[] {
  const agentLabel = targetLabelOf({
    name: agent.name,
    environment: agent.environment,
    ownerName: agent.owner?.name,
    differingNames: new Set(),
  });
  return (agent.parameters ?? []).map((definition) => ({
    ...definition,
    source: "agent" as const,
    agentLabel,
  }));
}

/**
 * Every parameter the run can carry: the union of what the scenarios in it
 * declare, then what its agents declare.
 *
 * A scenario declaration wins over an agent's on a name both declare, the way
 * the server resolves it.
 */
export function unionParameterDefinitions({
  scenarioIds,
  scenarios,
  agents = [],
}: {
  scenarioIds: string[];
  scenarios: readonly { id: string; parameters: unknown }[];
  /** The agents the run goes against, for the parameters they declare. */
  agents?: readonly ParameterDeclaringAgent[];
}): DeclaredParameter[] {
  const union = scenarioDeclaredParameters({ scenarioIds, scenarios });
  for (const definition of agents.flatMap(agentDeclaredParameters)) {
    if (union.has(definition.name)) continue;
    union.set(definition.name, definition);
  }
  return [...union.values()];
}

/**
 * The values the run sends, read back from what the confirmation shows.
 *
 * A name left empty is omitted rather than sent as an empty string: the run
 * then falls back to whatever default each scenario declares for it, which is
 * the same path a run that was never offered the name at all takes.
 *
 * A secret keeps whatever was typed as text. A token of digits is still a
 * token, and reading it as a number would both change it and have the run
 * refuse it, because a secret value has to be a string.
 */
export function toRunParameters({
  definitions,
  values,
}: {
  definitions: ScenarioParameterDefinition[];
  values: Record<string, string>;
}): RunParameterValues | undefined {
  const parameters: RunParameterValues = {};
  for (const definition of definitions) {
    const typed = values[definition.name] ?? "";
    if (definition.secret === true) {
      if (typed !== "") parameters[definition.name] = typed;
      continue;
    }
    const value = serializeOptionalTypedScalarValue({
      raw: typed,
      type: definition.type,
    });
    if (value === undefined) continue;
    parameters[definition.name] = value;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

export function useRunSuite(options: UseRunSuiteOptions = {}) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useUtils();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [pendingSuite, setPendingSuite] = useState<SimulationSuite | null>(
    null,
  );
  const [pendingBatchRunId, setPendingBatchRunId] = useState<string | null>(
    null,
  );
  /** Only the names typed over in the confirmation, keyed by name. */
  const [parameterOverrides, setParameterOverrides] = useState<
    Record<string, string>
  >({});

  const runMutation = api.suites.run.useMutation({
    onSuccess: (result, variables) => {
      void utils.scenarios.getSuiteRunData.invalidate();
      setPendingSuite(null);

      const archivedCount =
        (result.skippedArchived?.scenarios?.length ?? 0) +
        (result.skippedArchived?.targets?.length ?? 0);

      if (archivedCount > 0) {
        const parts: string[] = [];
        if (result.skippedArchived.scenarios.length > 0) {
          parts.push(
            `${result.skippedArchived.scenarios.length} archived scenario${result.skippedArchived.scenarios.length > 1 ? "s" : ""}`,
          );
        }
        if (result.skippedArchived.targets.length > 0) {
          parts.push(
            `${result.skippedArchived.targets.length} archived target${result.skippedArchived.targets.length > 1 ? "s" : ""}`,
          );
        }

        toaster.create({
          title: `Run plan scheduled (${result.jobCount} jobs)`,
          description: `${parts.join(" and ")} skipped.`,
          type: "warning",
          action: {
            label: "Edit Run Plan",
            onClick: () => {
              openDrawer("suiteEditor", {
                urlParams: { suiteId: variables.id },
              });
            },
          },
        });
      } else {
        toaster.create({
          title: `Run plan scheduled (${result.jobCount} jobs)`,
          type: "success",
          action: optionsRef.current.onViewRun
            ? {
                label: "View run",
                onClick: () => optionsRef.current.onViewRun?.(variables.id),
              }
            : undefined,
        });
      }

      optionsRef.current.onRunScheduled?.(
        variables.id,
        variables.batchRunId ?? result.batchRunId,
      );
    },
    onError: (err, variables) => {
      setPendingSuite(null);
      setPendingBatchRunId(null);

      showSuiteRunError({
        error: err,
        fallbackTitle: "Couldn't start run plan",
        onEditRunPlan: () => {
          openDrawer("suiteEditor", { urlParams: { suiteId: variables.id } });
        },
      });
    },
  });

  // Fetch active scenarios to exclude archived ones from the confirmation count
  const { data: allScenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && !!pendingSuite },
  );

  const parameterDefinitions = useMemo(() => {
    if (!pendingSuite || !allScenarios) return [];
    return unionParameterDefinitions({
      scenarioIds: pendingSuite.scenarioIds,
      scenarios: allScenarios,
    });
  }, [pendingSuite, allScenarios]);

  /**
   * What the confirmation shows for each name: the declared default, replaced
   * by whatever was typed over it. Only the overrides are held in state, so a
   * default that arrives with the scenarios cannot overwrite an edit made
   * before they loaded.
   */
  const parameterValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const definition of parameterDefinitions) {
      values[definition.name] =
        parameterOverrides[definition.name] ??
        displayTypedValue({
          value: definition.defaultValue,
          type: definition.type,
        });
    }
    return values;
  }, [parameterDefinitions, parameterOverrides]);

  const setParameterValue = useCallback((name: string, value: string) => {
    setParameterOverrides((previous) => ({ ...previous, [name]: value }));
  }, []);

  const requestRun = useCallback(
    (suite: SimulationSuite) => {
      if (!project || runMutation.isPending) return;
      setParameterOverrides({});
      setPendingSuite(suite);
    },
    [project, runMutation.isPending],
  );

  const confirmRun = useCallback(() => {
    if (!project || !pendingSuite || runMutation.isPending) return;
    const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
    setPendingBatchRunId(batchRunId);
    runMutation.mutate({
      projectId: project.id,
      id: pendingSuite.id,
      idempotencyKey: crypto.randomUUID(),
      batchRunId,
      parameters: toRunParameters({
        definitions: parameterDefinitions,
        values: parameterValues,
      }),
    });
  }, [
    project,
    pendingSuite,
    runMutation,
    parameterDefinitions,
    parameterValues,
  ]);

  const cancelRun = useCallback(() => {
    if (runMutation.isPending) return;
    setParameterOverrides({});
    setPendingSuite(null);
  }, [runMutation.isPending]);

  const activeScenarioCount = useMemo(() => {
    if (!pendingSuite || !allScenarios)
      return pendingSuite?.scenarioIds.length ?? 0;
    const activeIds = new Set(allScenarios.map((s) => s.id));
    return pendingSuite.scenarioIds.filter((id) => activeIds.has(id)).length;
  }, [pendingSuite, allScenarios]);

  const targetCount = useMemo(() => {
    if (!pendingSuite) return 0;
    return parseSuiteTargets(pendingSuite.targets).length;
  }, [pendingSuite]);

  return {
    requestRun,
    confirmRun,
    cancelRun,
    isPending: runMutation.isPending,
    pendingBatchRunId,
    /** Props to spread onto SuiteRunConfirmationDialog */
    dialogProps: {
      open: !!pendingSuite,
      onClose: cancelRun,
      onConfirm: confirmRun,
      suiteName: pendingSuite?.name ?? "",
      scenarioCount: activeScenarioCount,
      targetCount,
      repeatCount: pendingSuite?.repeatCount ?? 1,
      isLoading: runMutation.isPending,
      parameters: parameterDefinitions,
      parameterValues,
      onParameterChange: setParameterValue,
    },
  };
}
