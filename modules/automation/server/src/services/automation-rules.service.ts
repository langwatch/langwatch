/**
 * The rules every automation door shares, over the collaborators they need.
 *
 * They were the application's own methods, and they still answer for it; they
 * live here so the authoring service can ask them without reaching back through
 * the application that owns it. Nothing here is new: each rule is the one a
 * door already enforced, in one copy rather than two.
 */
import {
  AutomationNotInProjectError,
  AutomationWebhookNotEnabledError,
  GraphNotInProjectError,
  hasActionableTriggerFilters,
  ProjectNotFoundError,
  TriggerFiltersRequiredError,
  type AutomationApi,
  type Trigger,
} from "@langwatch/automation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/** The project an automation names, as a test fire renders it. */
export interface AutomationProjectIdentity {
  readonly name: string;
  readonly slug: string;
}

/** What the shared rules read the world through. */
export interface AutomationRulesCollaborators {
  automation: AutomationApi;
  projects: ProjectApi;
  featureFlags: FeatureFlagApi;
}

export class AutomationRulesService {
  static create(collaborators: AutomationRulesCollaborators): AutomationRulesService {
    return new AutomationRulesService(collaborators);
  }

  private constructor(private readonly collaborators: AutomationRulesCollaborators) {}

  /**
   * One LIVE automation, or null when the project does not have one. The store
   * answers with soft-deleted rows too, so every caller had to test `deleted` —
   * and the two doors did not agree, so the same id answered "gone" at one door
   * and "here it is" at the other.
   */
  async findLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    const trigger = await this.collaborators.automation.tryGetById(input);

    return !trigger || trigger.deleted ? null : trigger;
  }

  /** One live automation, refusing when the project does not have it. */
  async getById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const trigger = await this.findLiveById(input);

    if (!trigger) throw new AutomationNotInProjectError(input.triggerId, input.projectId);

    return trigger;
  }

  /**
   * Refuses a graph alert whose graph is not this project's. Without it a
   * hostile client could attach an alert to another tenant's graph.
   */
  async assertCustomGraphInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<void> {
    const exists = await this.collaborators.automation.customGraphExistsInProject(input);

    if (!exists) throw new GraphNotInProjectError(input.customGraphId, input.projectId);
  }

  /** Refuses a trace automation with no condition. */
  assertTraceConditionPresent(filters: Record<string, unknown> | undefined): void {
    if (!hasActionableTriggerFilters(filters ?? {})) {
      throw new TriggerFiltersRequiredError();
    }
  }

  /**
   * Refuses an edit that would leave a trace automation matching everything: an
   * automation whose condition lives in its query keeps a legitimately empty
   * structured set, and alerts and reports have no trace condition at all.
   */
  assertConditionSurvivesEdit(input: {
    existing: Trigger;
    filters: Record<string, unknown> | undefined;
  }): void {
    if (input.filters === undefined) return;
    if (hasActionableTriggerFilters(input.filters)) return;
    if (input.existing.triggerKind !== "AUTOMATION") return;
    if ((input.existing.filterQuery ?? "").trim() !== "") return;

    throw new TriggerFiltersRequiredError();
  }

  /**
   * Refuses the webhook delivery channel unless it is switched on for the
   * project (ADR-040 §7). The picker is flag-gated client-side and both writing
   * doors gate it too, so the flag cannot be bypassed by calling the API.
   */
  async assertWebhookChannelEnabled(input: { projectId: string; userId: string }): Promise<void> {
    const allowed = await this.collaborators.featureFlags.isEnabled("release_webhook_automations", {
      kind: "project",
      userId: input.userId,
      projectId: input.projectId,
    });

    if (!allowed) throw new AutomationWebhookNotEnabledError(input.projectId);
  }

  /** The project's name and slug, as a rendered notification quotes them. */
  async getProjectIdentity(projectId: string): Promise<AutomationProjectIdentity> {
    const project = await this.collaborators.projects.tryGetSummaryById(projectId);

    if (!project) throw new ProjectNotFoundError(projectId);

    return { name: project.name, slug: project.slug };
  }
}
