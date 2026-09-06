/**
 * Resolving what a suite run covers: the scenarios its scope names, the targets it points at,
 * and the human labels a run plan is titled with.
 */
import {
  derivePlanName,
  RUN_ALL_SUITE_NAME,
  normalizePlanScope,
  sortSuiteTargets,
  targetLabels,
  type Suite,
  type SuiteScope,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  ScenarioTestSuiteNotFoundError,
} from "@langwatch/scenario-contract";
import { SuiteNotFoundError } from "@langwatch/suite-contract";
import { ConnectedTargetService, type ConnectedTargetAgent } from "./connected-target.service.ts";
import { isAgentTarget } from "../rules/suite-target.rules.ts";
import type { SuiteServiceOptions } from "./suite.service.ts";

export class SuiteRunScopeService {
  static create(options: SuiteServiceOptions): SuiteRunScopeService {
    return new SuiteRunScopeService(options);
  }

  private constructor(private readonly options: SuiteServiceOptions) {}

  async resolveRunMembership(input: {
    suite: Suite;
    scopeIsDynamic: boolean;
    projectId: string;
  }): Promise<string[]> {
    if (input.suite.kind === "test_suite") {
      try {
        const definition = await this.options.scenarios.getTestSuiteRunDefinition({
          testSuiteId: input.suite.id,
          projectId: input.projectId,
        });

        return definition.scenarioIds;
      } catch (error) {
        if (error instanceof ScenarioTestSuiteNotFoundError) {
          throw new SuiteNotFoundError(input.suite.id);
        }

        throw error;
      }
    }

    if (!input.scopeIsDynamic) {
      return input.suite.scenarioIds;
    }

    return this.options.repository.resolveDynamicRunMembership({
      id: input.suite.id,
      projectId: input.projectId,
    });
  }

  /** Reads the project's active test suites only when the scope needs them. */
  async normalizeScope(input: { projectId: string; scope: SuiteScope }): Promise<SuiteScope> {
    if (input.scope.mode !== "test_suites") {
      return input.scope;
    }

    const testSuites = await this.options.scenarios.listTestSuites({
      projectId: input.projectId,
    });

    return normalizePlanScope({
      scope: input.scope,
      activeTestSuiteIds: testSuites.map((testSuite) => testSuite.id),
    });
  }

  /**
   * The name a run takes when its caller sends none: the scope, then the targets it goes
   * against — the same words the run dialog suggests, so a run started from the command line
   * and one started from the dialog over the same scope and targets land on one plan.
   */
  async defaultPlanName(params: {
    projectId: string;
    organizationId: string;
    scope: SuiteScope;
    /** The scenarios a hand-picked scope covers; read by that scope alone. */
    scenarioIds: string[];
    targets: SuiteTarget[];
  }): Promise<string> {
    const [scopeLabel, names] = await Promise.all([
      this.scopeLabel({
        projectId: params.projectId,
        scope: params.scope,
        scenarioIds: params.scenarioIds,
      }),
      this.resolveTargetNames({
        targets: params.targets,
        projectId: params.projectId,
        organizationId: params.organizationId,
      }),
    ]);

    return derivePlanName({
      scopeLabel,
      targetLabels: targetLabels({
        targets: sortSuiteTargets(params.targets),
        nameOf: (target) => names.get(target.referenceId) ?? target.referenceId,
      }),
    });
  }

  /**
   * What a scope is called in a run name. Every empty rule reads as
   * {@link RUN_ALL_SUITE_NAME}: a rule that names nothing covers everything
   * the moment it is resolved, so the name says so.
   */
  async scopeLabel(params: {
    projectId: string;
    scope: SuiteScope;
    scenarioIds: string[];
  }): Promise<string> {
    const { scope } = params;
    switch (scope.mode) {
      case "all":
        return RUN_ALL_SUITE_NAME;
      case "labels":
        return scope.labels.length === 0 ? RUN_ALL_SUITE_NAME : scope.labels.join(", ");
      case "test_suites":
        return this.testSuiteScopeLabel({
          projectId: params.projectId,
          testSuiteIds: scope.testSuiteIds,
        });
      case "scenarios":
        return this.caseScopeLabel({
          projectId: params.projectId,
          scenarioIds: params.scenarioIds,
        });
    }
  }

  /**
   * One or two test suites read by name, more read as a count: a name
   * listing five suites is no longer a name.
   */
  async testSuiteScopeLabel(params: {
    projectId: string;
    testSuiteIds: string[];
  }): Promise<string> {
    if (params.testSuiteIds.length === 0) {
      return RUN_ALL_SUITE_NAME;
    }

    if (params.testSuiteIds.length > 2) {
      return `${params.testSuiteIds.length} test suites`;
    }

    const named = new Set(params.testSuiteIds);
    const testSuites = await this.options.scenarios.listTestSuites({
      projectId: params.projectId,
    });
    const names = testSuites
      .filter((testSuite) => named.has(testSuite.id))
      .map((testSuite) => testSuite.name);

    return names.length === 0 ? RUN_ALL_SUITE_NAME : names.join(", ");
  }

  /**
   * One hand-picked scenario reads by its own name, several as a count: a
   * count in place of the one name would name every single-scenario run of
   * one agent the same thing, and they would all stack onto one run plan.
   */
  async caseScopeLabel(params: { projectId: string; scenarioIds: string[] }): Promise<string> {
    if (params.scenarioIds.length === 0) {
      return RUN_ALL_SUITE_NAME;
    }

    if (params.scenarioIds.length > 1) {
      return `${params.scenarioIds.length} scenarios`;
    }

    const rows = await this.options.scenarios.getNamesByIds({
      ids: params.scenarioIds,
      projectId: params.projectId,
    });

    return rows[0]?.name ?? "Selected scenario";
  }

  /**
   * What each target is called, by reference id. A reference the project no
   * longer holds is simply absent, so the caller decides what a removed
   * target reads as.
   */
  async resolveTargetNames(params: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<Map<string, string>> {
    const { targets, projectId, organizationId } = params;
    const agentIds = targets
      .filter((target) => isAgentTarget(target))
      .map((target) => target.referenceId);
    const promptIds = targets
      .filter((target) => target.type === "prompt")
      .map((target) => target.referenceId);

    const [agentRows, promptRows] = await Promise.all([
      agentIds.length === 0 ? [] : this.options.agents.getNamesByIds({ ids: agentIds, projectId }),
      promptIds.length === 0
        ? []
        : this.options.prompts.getNamesByIds({ ids: promptIds, projectId, organizationId }),
    ]);

    return new Map([...agentRows, ...promptRows].map((row) => [row.id, row.name]));
  }

  async resolveScenarioReferences(input: {
    scenarioIds: string[];
    projectId: string;
    scenarios: ScenarioService;
  }): Promise<{ active: string[]; archived: string[]; missing: string[] }> {
    const rows = await input.scenarios.getReferenceStates({
      ids: input.scenarioIds,
      projectId: input.projectId,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const active: string[] = [];
    const archived: string[] = [];
    const missing: string[] = [];
    for (const id of input.scenarioIds) {
      const scenario = byId.get(id);
      if (!scenario) {
        missing.push(id);
      } else if (scenario.archivedAt) {
        archived.push(id);
      } else {
        active.push(id);
      }
    }

    return { active, archived, missing };
  }

  async resolveTargetReferences(input: {
    targets: SuiteTarget[];
    projectId: string;
    organizationId: string;
    agents: AgentService;
    prompts: PromptService;
  }): Promise<{
    active: SuiteTarget[];
    archived: SuiteTarget[];
    missing: SuiteTarget[];
    /** The active targets' own connected agents, for the ownership check. */
    connectedAgents: ConnectedTargetAgent[];
  }> {
    const agentTargets = input.targets.filter((target) => isAgentTarget(target));
    const promptTargets = input.targets.filter((target) => target.type === "prompt");
    const [agentRows, promptIds] = await Promise.all([
      agentTargets.length === 0
        ? []
        : input.agents.getReferenceStates({
            ids: agentTargets.map((target) => target.referenceId),
            projectId: input.projectId,
          }),
      promptTargets.length === 0
        ? []
        : input.prompts.getExistingIds({
            ids: promptTargets.map((target) => target.referenceId),
            projectId: input.projectId,
            organizationId: input.organizationId,
          }),
    ]);
    const agentById = new Map(agentRows.map((row) => [row.id, row]));
    const existingPromptIds = new Set(promptIds);
    const active: SuiteTarget[] = [];
    const archived: SuiteTarget[] = [];
    const missing: SuiteTarget[] = [];
    const connectedAgents: ConnectedTargetAgent[] = [];
    for (const target of agentTargets) {
      const agent = agentById.get(target.referenceId);
      if (!agent) {
        missing.push(target);
      } else if (agent.archivedAt || ConnectedTargetService.isAgentUnseen(agent)) {
        archived.push(target);
      } else {
        active.push(target);
        if (agent.type === "connected") {
          connectedAgents.push({
            id: agent.id,
            name: agent.name ?? agent.id,
            type: agent.type,
            ownerUserId: agent.ownerUserId ?? null,
          });
        }
      }
    }

    for (const target of promptTargets) {
      if (existingPromptIds.has(target.referenceId)) {
        active.push(target);
      } else {
        missing.push(target);
      }
    }

    return { active, archived, missing, connectedAgents };
  }
}
