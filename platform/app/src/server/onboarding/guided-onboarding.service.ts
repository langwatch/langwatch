/**
 * The guided onboarding state of an organization: what the user picked, what
 * is being set up, what is done. It lives in `Organization.signupData` under
 * `guidedOnboarding`, next to the rest of the sign-up answers, so a reload or
 * a second device continues where the user stopped.
 *
 * Every write goes through here, emits one event, and returns the state after
 * the write. A path outside the four the product knows is refused with a
 * handled error.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { NotFoundError } from "@langwatch/handled-error";
import {
  type GuidedPath,
  isGuidedPath,
} from "~/features/guided-onboarding/paths";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import {
  EMPTY_GUIDED_ONBOARDING_STATE,
  type GuidedOnboardingState,
  guidedOnboardingStateSchema,
  type OnboardingVariant,
} from "~/server/schemas/sign-up-data.schema";
import { GuidedOnboardingPathUnknownError } from "./guided-onboarding.errors";
import {
  type GuidedOnboardingEvent,
  onGuidedOnboardingEvent,
} from "./guided-onboarding.events";

export type TourStatus = "completed" | "skipped" | "replayed";

/**
 * Reads the guided block out of a stored sign-up data value. Anything that is
 * not the expected shape reads as the empty default: a hand-edited row must
 * not turn the welcome flow into an error.
 */
export function parseGuidedOnboardingState(
  signupData: unknown,
): GuidedOnboardingState {
  const block =
    signupData && typeof signupData === "object"
      ? (signupData as Record<string, unknown>).guidedOnboarding
      : undefined;
  const parsed = guidedOnboardingStateSchema.safeParse(block);
  return parsed.success ? parsed.data : EMPTY_GUIDED_ONBOARDING_STATE;
}

export function parseOnboardingVariant(
  signupData: unknown,
): OnboardingVariant | null {
  const variant =
    signupData && typeof signupData === "object"
      ? (signupData as Record<string, unknown>).onboardingVariant
      : undefined;
  return variant === "guided" || variant === "classic" ? variant : null;
}

function assertGuidedPath(path: string): GuidedPath {
  if (!isGuidedPath(path)) throw new GuidedOnboardingPathUnknownError(path);
  return path;
}

function assertGuidedPaths(paths: string[]): GuidedPath[] {
  const unique: GuidedPath[] = [];
  for (const path of paths) {
    const known = assertGuidedPath(path);
    if (!unique.includes(known)) unique.push(known);
  }
  return unique;
}

interface Actor {
  organizationId: string;
  /** Absent when the write came through a project credential with no user. */
  userId: string | undefined;
}

export class GuidedOnboardingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static create(prisma: PrismaClient): GuidedOnboardingService {
    return new GuidedOnboardingService(prisma);
  }

  /**
   * The organization a project credential speaks for. The REST route and the
   * CLI reach the state through a project key, and the state is the
   * organization's.
   */
  async organizationIdOfProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", projectId);
    }
    return project.team.organizationId;
  }

  async getState({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GuidedOnboardingState> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { signupData: true },
    });
    if (!organization) {
      throw new NotFoundError(
        "organization_not_found",
        "Organization",
        organizationId,
      );
    }
    return parseGuidedOnboardingState(organization.signupData);
  }

  /** The picks from the value screen, in order. The first one starts now. */
  async recordPaths(
    actor: Actor,
    { paths }: { paths: string[] },
  ): Promise<GuidedOnboardingState> {
    const picked = assertGuidedPaths(paths);
    return this.write(actor, {
      event: "paths_selected",
      payload: { paths: picked, primaryPath: picked[0] },
      mutate: (state) => ({
        ...state,
        paths: picked,
        currentPath: picked[0] ?? state.currentPath,
      }),
    });
  }

  async recordProvider(
    actor: Actor,
    { provider, model }: { provider: string; model: string },
  ): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "provider_connected",
      payload: { provider, model },
      mutate: (state) => ({ ...state, provider, providerModel: model }),
    });
  }

  async recordProviderSkipped(actor: Actor): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "provider_skipped",
      payload: {},
      mutate: (state) => ({
        ...state,
        providerSkippedAt: this.now().toISOString(),
      }),
    });
  }

  async recordTour(
    actor: Actor,
    { status }: { status: TourStatus },
  ): Promise<GuidedOnboardingState> {
    const at = this.now().toISOString();
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
      mutate: (state) => ({
        ...state,
        tourReplays: (state.tourReplays ?? 0) + 1,
      }),
    });
  }

  /**
   * Makes `path` the one being guided. A path the user never picked (the Home
   * offer lets a new user wander into any space) is appended to the picks.
   */
  async beginPath(
    actor: Actor,
    { path }: { path: string },
  ): Promise<GuidedOnboardingState> {
    const known = assertGuidedPath(path);
    return this.write(actor, {
      event: "path_begun",
      payload: { path: known },
      mutate: (state) => ({
        ...state,
        paths: state.paths.includes(known)
          ? state.paths
          : [...state.paths, known],
        currentPath: known,
      }),
    });
  }

  /**
   * Marks `path` done. Idempotent: a second completion changes nothing and
   * emits nothing, so a retried CLI call cannot fire a campaign twice.
   */
  async completePath(
    actor: Actor,
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
        currentPath:
          state.currentPath === known ? undefined : state.currentPath,
      }),
    });
  }

  async attachConversation(
    actor: Actor,
    { conversationId }: { conversationId: string },
  ): Promise<GuidedOnboardingState> {
    return this.write(actor, {
      event: "conversation_attached",
      payload: { conversationId },
      mutate: (state) => ({ ...state, conversationId }),
    });
  }

  private async write(
    { organizationId, userId }: Actor,
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
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { signupData: true },
    });
    if (!organization) {
      throw new NotFoundError(
        "organization_not_found",
        "Organization",
        organizationId,
      );
    }
    const next = mutate(parseGuidedOnboardingState(organization.signupData));
    const signupData =
      organization.signupData && typeof organization.signupData === "object"
        ? (organization.signupData as Record<string, unknown>)
        : {};
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        signupData: {
          ...signupData,
          guidedOnboarding: next,
        } as Prisma.InputJsonValue,
      },
    });
    onGuidedOnboardingEvent({
      organizationId,
      userId,
      event,
      payload,
      state: next,
    });
    return next;
  }
}
