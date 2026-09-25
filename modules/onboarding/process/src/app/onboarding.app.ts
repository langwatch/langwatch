import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  OnboardingApi,
  type OnboardingApi as OnboardingApiContract,
  type GuidedOnboardingState,
  type GuidedOnboardingStateWithInstance,
  type GuidedOnboardingStateWithVariant,
  type OnboardingCallerInput,
  type OnboardingInitializeOrganizationInput,
  type OnboardingSignUpCaller,
  type OrganizationInitialized,
} from "@langwatch/onboarding-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";

import { HttpPostHogEventsChannel } from "../channels/http/http.posthog-events.channel.ts";
import { withInstanceFacts } from "../rules/guided-onboarding-instance.rules.ts";
import { GuidedOnboardingService } from "../services/guided-onboarding.service.ts";

type OnboardingSetup = FeatureSetup<typeof OnboardingApp.dependencies, never, undefined>;

export class OnboardingApp implements OnboardingApiContract {
  static readonly contract = OnboardingApi;
  static readonly dependencies = {
    organizations: OrganizationApi,
    permissions: AuthzApi,
    ops: OpsApi,
    /** Where an app on this instance points; the gateway owns the address. */
    gateway: GatewayApi,
  };

  readonly #guided: GuidedOnboardingService;
  readonly #permissions: AuthzApi;
  readonly #gateway: Pick<GatewayApi, "getDeploymentAddresses">;
  readonly #organizations: Pick<
    OrganizationApi,
    "initializeOrganization" | "recordIntegrationMethod"
  >;

  private constructor(parts: {
    guided: GuidedOnboardingService;
    permissions: AuthzApi;
    gateway: Pick<GatewayApi, "getDeploymentAddresses">;
    organizations: Pick<OrganizationApi, "initializeOrganization" | "recordIntegrationMethod">;
  }) {
    this.#guided = parts.guided;
    this.#permissions = parts.permissions;
    this.#gateway = parts.gateway;
    this.#organizations = parts.organizations;
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

    return new OnboardingApp({
      guided,
      permissions: setup.dependencies.permissions,
      gateway: setup.dependencies.gateway,
      organizations: setup.dependencies.organizations,
    });
  }

  async getGuidedState(input: {
    organizationId: string;
    userId: string;
  }): Promise<GuidedOnboardingStateWithVariant> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);
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

  async completePath(
    input: OnboardingCallerInput & { path: string },
  ): Promise<GuidedOnboardingState> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);

    return this.#guided.completePath(this.actorOf(input), { path: input.path });
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

  private actorOf(input: OnboardingCallerInput): { organizationId: string; userId: string } {
    return { organizationId: input.organizationId, userId: input.userId };
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
