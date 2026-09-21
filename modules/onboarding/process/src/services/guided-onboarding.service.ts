/**
 * Guided onboarding state, owned by `modules/organization`
 * (`Organization.signupData.guidedOnboarding`) and reached only through
 * `OrganizationApi`. A path outside the four the product knows is refused.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import {
  GuidedOnboardingPathUnknownError,
  isGuidedPath,
  type GuidedOnboardingRecord,
  type GuidedOnboardingState,
  type GuidedPath,
} from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { PostHogEventsChannel } from "../channels/posthog-events.channel.ts";
import {
  guidedOnboardingTrackedEvent,
  type GuidedOnboardingEvent,
} from "../rules/guided-onboarding-analytics.rules.ts";

export type TourStatus = "completed" | "skipped" | "replayed";

export interface GuidedOnboardingActor {
  readonly organizationId: string;
  /** Absent when the write came through a project credential with no user. */
  readonly userId: string | undefined;
}

function assertGuidedPath(path: string): GuidedPath {
  if (!isGuidedPath(path)) throw new GuidedOnboardingPathUnknownError(path);
  return path;
}

function assertGuidedPaths(paths: readonly string[]): GuidedPath[] {
  const unique: GuidedPath[] = [];
  for (const path of paths) {
    const known = assertGuidedPath(path);
    if (!unique.includes(known)) unique.push(known);
  }
  return unique;
}

export class GuidedOnboardingService {
  private constructor(
    private readonly organizations: OrganizationApi,
    private readonly events: PostHogEventsChannel,
    private readonly now: () => string,
  ) {}

  static create(options: {
    organizations: OrganizationApi;
    events: PostHogEventsChannel;
    now?: () => string;
  }): GuidedOnboardingService {
    return new GuidedOnboardingService(
      options.organizations,
      options.events,
      options.now ?? (() => nowInstant().toString()),
    );
  }

  async getState(actor: { organizationId: string }): Promise<GuidedOnboardingState> {
    const record = await this.record(actor.organizationId);
    return record.state;
  }

  /**
   * The state with the variant the organization was assigned at sign-up,
   * null for one that predates the experiment. The Home offer shows only
   * in the guided variant.
   */
  async getStateWithVariant(actor: {
    organizationId: string;
  }): Promise<GuidedOnboardingState & { variant: GuidedOnboardingRecord["variant"] }> {
    const record = await this.record(actor.organizationId);
    return { ...record.state, variant: record.variant };
  }

  /** The picks from the value screen, in order. The first one starts now. */
  async recordPaths(
    actor: GuidedOnboardingActor,
    { paths }: { paths: readonly string[] },
  ): Promise<GuidedOnboardingState> {
    const picked = assertGuidedPaths(paths);
    return this.write(actor, {
      event: "paths_selected",
      payload: { paths: picked, primaryPath: picked[0] },
      mutate: (state) => ({ ...state, paths: picked, currentPath: picked[0] ?? state.currentPath }),
    });
  }

  async recordProvider(
    actor: GuidedOnboardingActor,
    { provider, model }: { provider: string; model: string },
  ): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "provider_connected",
      payload: { provider, model },
      mutate: (state) => ({ ...state, provider, providerModel: model }),
    });
  }

  /**
   * "Skip anyway" on the provider screen skips the guide as a whole: the
   * tour is recorded as skipped in the same breath, so the landing never
   * starts it and Langy opens with the no-worries line instead.
   */
  async recordProviderSkipped(actor: GuidedOnboardingActor): Promise<GuidedOnboardingState> {
    await this.write(actor, {
      event: "provider_skipped",
      payload: {},
      mutate: (state) => ({ ...state, providerSkippedAt: this.now() }),
    });
    return this.recordTour(actor, { status: "skipped" });
  }

  async recordTour(
    actor: GuidedOnboardingActor,
    { status }: { status: TourStatus },
  ): Promise<GuidedOnboardingState> {
    const at = this.now();
    if (status === "completed") {
      return this.write(actor, {
        event: "tour_completed",
        payload: {},
        mutate: (state) => ({ ...state, tourCompletedAt: at }),
      });
    }
    if (status === "skipped") {
      return this.write(actor, {
        event: "tour_skipped",
        payload: {},
        mutate: (state) => ({ ...state, tourSkippedAt: at }),
      });
    }
    return this.write(actor, {
      event: "tour_replayed",
      payload: {},
      mutate: (state) => ({ ...state, tourReplays: (state.tourReplays ?? 0) + 1 }),
    });
  }

  /**
   * Makes `path` the one being guided. A path the user never picked (the Home
   * offer lets a new user wander into any space) is appended to the picks.
   */
  async beginPath(
    actor: GuidedOnboardingActor,
    { path }: { path: string },
  ): Promise<GuidedOnboardingState> {
    const known = assertGuidedPath(path);
    return this.write(actor, {
      event: "path_begun",
      payload: { path: known },
      mutate: (state) => ({
        ...state,
        paths: state.paths.includes(known) ? state.paths : [...state.paths, known],
        currentPath: known,
      }),
    });
  }

  /**
   * Marks `path` done. Idempotent: a second completion changes nothing and
   * tracks nothing, so a retried CLI call cannot fire an analytics event twice.
   */
  async completePath(
    actor: GuidedOnboardingActor,
    { path }: { path: string },
  ): Promise<GuidedOnboardingState> {
    const known = assertGuidedPath(path);
    const current = await this.getState(actor);
    if (current.donePaths.includes(known)) return current;
    return this.write(actor, {
      event: "path_completed",
      payload: { path: known },
      mutate: (state) => ({
        ...state,
        donePaths: [...state.donePaths, known],
        currentPath: state.currentPath === known ? undefined : state.currentPath,
      }),
    });
  }

  async attachConversation(
    actor: GuidedOnboardingActor,
    { conversationId }: { conversationId: string },
  ): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "conversation_attached",
      payload: { conversationId },
      mutate: (state) => ({ ...state, conversationId }),
    });
  }

  /**
   * Records the virtual key the gateway tour minted: its name, its display
   * prefix and the one-time reveal id that serves its secret to the Langy
   * card. A replay that mints another key replaces the earlier one.
   */
  async recordVirtualKeyReveal(
    actor: GuidedOnboardingActor,
    { name, preview, revealId }: { name: string; preview: string; revealId: string },
  ): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "virtual_key_minted",
      payload: { name },
      mutate: (state) => ({
        ...state,
        virtualKeyName: name,
        virtualKeyPreview: preview,
        virtualKeyRevealId: revealId,
      }),
    });
  }

  private record(organizationId: string): Promise<GuidedOnboardingRecord> {
    return this.organizations.readGuidedOnboardingState({ organizationId });
  }

  private async write(
    { organizationId, userId }: GuidedOnboardingActor,
    {
      event,
      payload,
      mutate,
    }: {
      event: GuidedOnboardingEvent;
      payload: Record<string, string | string[] | number | undefined>;
      mutate: (state: GuidedOnboardingState) => GuidedOnboardingState;
    },
  ): Promise<GuidedOnboardingState> {
    const previous = await this.record(organizationId);
    const next = mutate(previous.state);
    await this.organizations.writeGuidedOnboardingState({
      organizationId,
      record: { state: next, variant: previous.variant },
    });
    this.track({ organizationId, userId, event, payload, state: next });
    return next;
  }

  /**
   * Fire and forget, and only when the write carries a user: a project
   * credential with no user attaches to nobody, so it tracks nothing rather
   * than guessing an admin to attribute the event to.
   */
  private track({
    organizationId,
    userId,
    event,
    payload,
    state,
  }: {
    organizationId: string;
    userId: string | undefined;
    event: GuidedOnboardingEvent;
    payload: Record<string, string | string[] | number | undefined>;
    state: GuidedOnboardingState;
  }): void {
    if (!userId) return;
    const tracked = guidedOnboardingTrackedEvent({ event, payload, state, organizationId });
    if (!tracked.tracked) return;
    this.events.track({ userId, event: tracked.name, properties: tracked.properties });
  }
}
