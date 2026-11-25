import { VOICE_AGENTS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  sortSuiteTargets,
  VoiceAgentsDisabledError,
  type SuiteRunInput,
  type SuiteTarget,
} from "@langwatch/suite-contract";

import { AgentOwnerNamesService } from "./agent-owner-names.service.ts";
import { ConnectedTargetService } from "./connected-target.service.ts";
import { SuiteRunScopeService } from "./suite-run-scope.service.ts";
import type { SuiteServiceOptions } from "./suite.service.ts";

/** What a run covers: its scenario and target references, and the voice gate on its targets. */
export class SuiteRunReferencesService {
  static create(options: SuiteServiceOptions): SuiteRunReferencesService {
    return new SuiteRunReferencesService(options);
  }

  private readonly scope: SuiteRunScopeService;

  private constructor(private readonly options: SuiteServiceOptions) {
    this.scope = SuiteRunScopeService.create(options);
  }

  /**
   * A voice target reaches the call panel and the ElevenLabs adapter, both behind
   * `release_voice_agents_enabled` (AC29); a run naming one is refused while it is off.
   */
  async assertVoiceTargetsAllowed({
    targets,
    projectId,
    organizationId,
  }: {
    targets: readonly SuiteTarget[];
    projectId: string;
    organizationId: string;
  }): Promise<void> {
    if (!targets.some((target) => target.type === "voice")) return;
    const enabled = await this.options.featureFlags.isEnabled(VOICE_AGENTS_FLAG_KEY, {
      kind: "project",
      projectId,
      organizationId,
    });
    if (!enabled) throw new VoiceAgentsDisabledError();
  }

  /**
   * The scenarios and targets a run actually covers, with every refusal raised before anything
   * is stored: a missing or fully archived reference, and a connected agent nobody may run.
   */
  async resolveRunReferences({
    scenarioIds,
    targets,
    sortTargets = false,
    projectId,
    organizationId,
    actor,
  }: {
    scenarioIds: string[];
    targets: SuiteTarget[];
    sortTargets?: boolean;
    projectId: string;
    organizationId: string;
    actor: SuiteRunInput["actor"];
  }): Promise<{
    scenarioResolution: Awaited<ReturnType<SuiteRunScopeService["resolveScenarioReferences"]>>;
    targetResolution: Awaited<ReturnType<SuiteRunScopeService["resolveTargetReferences"]>>;
    namedTargets: SuiteTarget[];
  }> {
    const { scenarios, agents, prompts } = this.options;
    const scenarioResolution = await this.scope.resolveScenarioReferences({
      scenarioIds,
      projectId,
      scenarios,
    });
    if (scenarioResolution.missing.length > 0) {
      throw new InvalidScenarioReferencesError({ invalidIds: scenarioResolution.missing });
    }

    if (scenarioResolution.active.length === 0) {
      throw new AllScenariosArchivedError();
    }

    // A connected target may be named `<name>@<environment>`; from here on
    // every target names an id, so two spellings of one agent fold together.
    const connected = ConnectedTargetService.create({
      agents,
      owners: AgentOwnerNamesService.create(agents),
      ...(this.options.connectedPresence ? { presence: this.options.connectedPresence } : {}),
    });
    const namedTargets = await connected.resolveConnectedReferences({ targets, projectId, actor });
    const targetResolution = await this.scope.resolveTargetReferences({
      targets: sortTargets ? sortSuiteTargets(namedTargets) : namedTargets,
      projectId,
      organizationId,
      agents,
      prompts,
    });
    if (targetResolution.missing.length > 0) {
      throw new InvalidTargetReferencesError({
        invalidIds: targetResolution.missing.map((target) => target.referenceId),
      });
    }

    if (targetResolution.active.length === 0) {
      throw new AllTargetsArchivedError();
    }

    await connected.assertConnectedAgentsRunnable({
      agents: targetResolution.connectedAgents,
      actor,
    });

    return { scenarioResolution, targetResolution, namedTargets };
  }
}
