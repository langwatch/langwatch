import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { DashboardApi } from "@langwatch/dashboard-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import {
  OnboardingApi,
  type OnboardingApi as OnboardingApiContract,
  type GuidedOnboardingForProject,
  type GuidedOnboardingState,
  type GuidedOnboardingStateWithInstance,
  type GuidedOnboardingStateWithVariant,
  type GuidedOnboardingTrackedEvent,
  type IntegrationsCheckStatus,
  type OnboardingCallerInput,
  type OnboardingInitializeOrganizationInput,
  type OnboardingSignUpCaller,
  type OrganizationInitialized,
} from "@langwatch/onboarding-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

import { HttpPostHogEventsChannel } from "../channels/http/http.posthog-events.channel.ts";
import { withInstanceFacts } from "../rules/guided-onboarding-instance.rules.ts";
import { GuidedOnboardingService } from "../services/guided-onboarding.service.ts";
import { OnboardingChecksService } from "../services/onboarding-checks.service.ts";
import type { IntegrationsChecksApi } from "../transport/integrations-checks.trpc.ts";

type OnboardingSetup = FeatureSetup<typeof OnboardingApp.dependencies, never, undefined>;

export class OnboardingApp implements OnboardingApiContract, IntegrationsChecksApi {
  static readonly contract = OnboardingApi;
  static readonly dependencies = {
    organizations: OrganizationApi,
    permissions: AuthzApi,
    ops: OpsApi,
    /** Where an app on this instance points; the gateway owns the address. */
    gateway: GatewayApi,
    /** The project-to-organization hop a project-scoped read resolves through. */
    projects: ProjectApi,
    /** The owners the setup checklist asks for each of its figures. */
    workflows: WorkflowApi,
    dashboards: DashboardApi,
    datasets: DatasetApi,
    monitors: MonitorApi,
    automations: AutomationApi,
    scenarios: ScenarioApi,
    modelProviders: ModelProviderApi,
    prompts: PromptApi,
  };

  readonly #guided: GuidedOnboardingService;
  readonly #checks: OnboardingChecksService;
  readonly #permissions: AuthzApi;
  readonly #gateway: Pick<GatewayApi, "getDeploymentAddresses">;
  readonly #organizations: Pick<
    OrganizationApi,
    "initializeOrganization" | "recordIntegrationMethod"
  >;
  readonly #projects: Pick<ProjectApi, "getOrganizationId">;

  private constructor(parts: {
    guided: GuidedOnboardingService;
    checks: OnboardingChecksService;
    permissions: AuthzApi;
    gateway: Pick<GatewayApi, "getDeploymentAddresses">;
    organizations: Pick<OrganizationApi, "initializeOrganization" | "recordIntegrationMethod">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }) {
    this.#guided = parts.guided;
    this.#checks = parts.checks;
    this.#permissions = parts.permissions;
    this.#gateway = parts.gateway;
    this.#organizations = parts.organizations;
    this.#projects = parts.projects;
  }

  static create(setup: OnboardingSetup): OnboardingApp {
    const ops = setup.dependencies.ops;
    const events = HttpPostHogEventsChannel.create({
      targets: () => ops.findProductAnalyticsTargets(),
    });
    setup.resources.own("Onboarding PostHog client", () => events.close());
    const guided = GuidedOnboardingService.create({
      organizations: setup.dependencies.organizations,
      events,
    });

    const { dependencies } = setup;
    const checks = OnboardingChecksService.create({
      guided,
      peers: {
        projects: dependencies.projects,
        workflows: dependencies.workflows,
        dashboards: dependencies.dashboards,
        datasets: dependencies.datasets,
        monitors: dependencies.monitors,
        automations: dependencies.automations,
        scenarios: dependencies.scenarios,
        modelProviders: dependencies.modelProviders,
        prompts: dependencies.prompts,
        permissions: dependencies.permissions,
      },
    });

    return new OnboardingApp({
      guided,
      checks,
      permissions: setup.dependencies.permissions,
      gateway: setup.dependencies.gateway,
      organizations: setup.dependencies.organizations,
      projects: setup.dependencies.projects,
    });
  }

  async getGuidedState(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<GuidedOnboardingStateWithVariant> {
    await this.authorizeNamedPerson(input.userId, input.organizationId);
    const state = await this.#guided.getStateWithVariant({ organizationId: input.organizationId });

    return withInstanceFacts(state, this.#gateway.getDeploymentAddresses());
  }

  async recordPaths(
    input: OnboardingCallerInput & { paths: readonly string[] },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.recordPaths(this.actorOf(input), { paths: input.paths });
  }

  async recordProvider(
    input: OnboardingCallerInput & { provider: string; model: string },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.recordProvider(this.actorOf(input), {
      provider: input.provider,
      model: input.model,
    });
  }

  async recordProviderSkipped(input: OnboardingCallerInput): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.recordProviderSkipped(this.actorOf(input));
  }

  async recordVirtualKeyReveal(
    input: OnboardingCallerInput & { name: string; preview: string; revealId: string },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.recordVirtualKeyReveal(this.actorOf(input), {
      name: input.name,
      preview: input.preview,
      revealId: input.revealId,
    });
  }

  async recordTour(
    input: OnboardingCallerInput & { status: "completed" | "skipped" | "replayed" },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.recordTour(this.actorOf(input), { status: input.status });
  }

  async beginPath(
    input: OnboardingCallerInput & { path: string },
  ): Promise<GuidedOnboardingStateWithInstance> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);
    const state = await this.#guided.beginPath(this.actorOf(input), { path: input.path });

    return withInstanceFacts(state, this.#gateway.getDeploymentAddresses());
  }

  async completePath(input: {
    organizationId: string;
    userId: string | null;
    path: string;
  }): Promise<GuidedOnboardingState> {
    await this.authorizeNamedPerson(input.userId, input.organizationId);
    const actor = { organizationId: input.organizationId, userId: input.userId ?? undefined };

    return this.#guided.completePath(actor, { path: input.path });
  }

  async attachConversation(
    input: OnboardingCallerInput & { conversationId: string },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.attachConversation(this.actorOf(input), {
      conversationId: input.conversationId,
    });
  }

  initializeOrganization(
    input: OnboardingInitializeOrganizationInput,
    by: OnboardingSignUpCaller,
  ): Promise<OrganizationInitialized> {
    const { onboardingVariant, ...rest } = input;
    if (onboardingVariant === undefined)
      return this.#organizations.initializeOrganization(rest, by);

    return this.#organizations.initializeOrganization(
      { ...rest, signUpData: { ...rest.signUpData, onboardingVariant } },
      by,
    );
  }

  recordIntegrationMethod(input: { userId: string; selection: string }): void {
    this.#organizations.recordIntegrationMethod(input);
  }

  async getGuidedStateByProject(input: { projectId: string }): Promise<GuidedOnboardingForProject> {
    const organizationId = await this.#projects.getOrganizationId(input.projectId);
    const { variant, ...state } = await this.#guided.getStateWithVariant({ organizationId });

    return { organizationId, variant, state };
  }

  getCheckStatus(input: { projectId: string }): Promise<IntegrationsCheckStatus> {
    return this.#checks.getCheckStatus(input);
  }

  trackGuidedOnboardingEvent(input: GuidedOnboardingTrackedEvent): void {
    this.#guided.trackEvent({
      userId: input.userId,
      event: input.event,
      projectId: input.projectId,
      properties: input.properties,
      uuid: input.uuid,
    });
  }

  private actorOf(input: OnboardingCallerInput): { organizationId: string; userId: string } {
    return { organizationId: input.organizationId, userId: input.userId };
  }

  /** A project key bound to no user was already checked by the REST door, as on main. */
  private async authorizeNamedPerson(userId: string | null, organizationId: string): Promise<void> {
    if (userId !== null) await this.authorizeOrganizationView(userId, organizationId);
  }

  private async authorizeOrganizationView(userId: string, organizationId: string): Promise<void> {
    const permitted = await this.#permissions.hasPermission({
      userId,
      permission: "organization:view",
      organizationId,
    });
    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "organization:view",
        scope: { type: "organization", id: organizationId },
        denialReason: "no-membership",
      });
    }
  }
}
