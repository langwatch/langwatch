import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  OnboardingApi,
  onboardingConfig,
  type OnboardingApi as OnboardingApiContract,
  type GuidedOnboardingState,
  type GuidedOnboardingStateWithInstance,
  type GuidedOnboardingStateWithVariant,
  type OnboardingCallerInput,
  type OnboardingServerConfig,
} from "@langwatch/onboarding-contract";
import { OrganizationApi } from "@langwatch/organization-contract";

import { HttpPostHogEventsChannel } from "../channels/http/http.posthog-events.channel.ts";
import { MemoryPostHogEventsChannel } from "../channels/memory/memory.posthog-events.channel.ts";
import type { PostHogEventsChannel } from "../channels/posthog-events.channel.ts";
import {
  withInstanceFacts,
  type GuidedOnboardingGatewayConfig,
} from "../rules/guided-onboarding-instance.rules.ts";
import { GuidedOnboardingService } from "../services/guided-onboarding.service.ts";

type OnboardingSetup = FeatureSetup<
  typeof OnboardingApp.dependencies,
  never,
  OnboardingServerConfig
>;

export class OnboardingApp implements OnboardingApiContract {
  static readonly contract = OnboardingApi;
  static readonly dependencies = { organizations: OrganizationApi, permissions: AuthzApi };
  static readonly config = onboardingConfig;

  readonly #guided: GuidedOnboardingService;
  readonly #permissions: AuthzApi;
  readonly #gateway: GuidedOnboardingGatewayConfig;

  private constructor(
    guided: GuidedOnboardingService,
    permissions: AuthzApi,
    gateway: GuidedOnboardingGatewayConfig,
  ) {
    this.#guided = guided;
    this.#permissions = permissions;
    this.#gateway = gateway;
  }

  static create(setup: OnboardingSetup): OnboardingApp {
    const events = OnboardingApp.eventsChannelOf(setup);
    if (events instanceof HttpPostHogEventsChannel) {
      setup.resources.own("Onboarding PostHog client", () => events.close());
    }
    const guided = GuidedOnboardingService.create({
      organizations: setup.dependencies.organizations,
      events,
    });

    return new OnboardingApp(guided, setup.dependencies.permissions, setup.config.gateway);
  }

  /**
   * Fail-safe rather than fail-closed: a deployment with no PostHog key gets
   * the memory channel, which tracks nothing rather than refusing a write.
   */
  private static eventsChannelOf(setup: OnboardingSetup): PostHogEventsChannel {
    const key = setup.config.productAnalytics.key;
    if (!key) return MemoryPostHogEventsChannel.create();

    return HttpPostHogEventsChannel.create({
      key,
      ...(setup.config.productAnalytics.host ? { host: setup.config.productAnalytics.host } : {}),
    });
  }

  async getGuidedState(input: {
    organizationId: string;
    userId: string;
  }): Promise<GuidedOnboardingStateWithVariant> {
    await this.authorizeOrganizationView(input.userId, input.organizationId);
    const state = await this.#guided.getStateWithVariant({ organizationId: input.organizationId });

    return withInstanceFacts(state, this.#gateway);
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

    return withInstanceFacts(state, this.#gateway);
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
