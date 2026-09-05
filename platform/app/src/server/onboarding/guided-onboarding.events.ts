import {
  fireGuidedOnboardingPathsNurturing,
  fireGuidedOnboardingProgressNurturing,
} from "~/../ee/billing/nurturing/hooks/guidedOnboarding";
import { prisma } from "~/server/db";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { trackGuidedOnboardingEvent } from "./guided-onboarding.analytics";

/**
 * What happened to an organization's guided onboarding, emitted after every
 * write of its state. Product analytics and the nurturing platform subscribe
 * here, so the procedures that write the state never know about either.
 */
export type GuidedOnboardingEvent =
  | "paths_selected"
  | "provider_connected"
  | "provider_skipped"
  | "tour_completed"
  | "tour_skipped"
  | "tour_replayed"
  | "path_begun"
  | "path_completed"
  | "conversation_attached";

export interface GuidedOnboardingEventInput {
  organizationId: string;
  /** Absent when the write came through a project credential with no user. */
  userId: string | undefined;
  event: GuidedOnboardingEvent;
  /** What the event carries beyond the state: the path, the provider. */
  payload: Record<string, string | string[] | number | undefined>;
  /** The guided state before the write, so a subscriber can tell what changed. */
  previous: GuidedOnboardingState;
  /** The guided state after the write. */
  state: GuidedOnboardingState;
}

/** The same event once it has a user to attribute it to. */
export type AttributedGuidedOnboardingEvent = Omit<
  GuidedOnboardingEventInput,
  "userId"
> & { userId: string };

/**
 * Fan-out point for every guided onboarding event. Fire and forget: a
 * subscriber that fails must not fail the write that produced the event, and
 * one subscriber failing must not keep the other from running.
 */
export function onGuidedOnboardingEvent(
  input: GuidedOnboardingEventInput,
): void {
  void dispatch(input).catch((error) => captureException(toError(error)));
}

async function dispatch(input: GuidedOnboardingEventInput): Promise<void> {
  const userId =
    input.userId ??
    (await resolveOrganizationAdminUserId(input.organizationId));
  if (!userId) return;

  const attributed: AttributedGuidedOnboardingEvent = { ...input, userId };
  for (const subscriber of SUBSCRIBERS) {
    try {
      subscriber(attributed);
    } catch (error) {
      captureException(toError(error));
    }
  }
}

const SUBSCRIBERS: ReadonlyArray<
  (event: AttributedGuidedOnboardingEvent) => void
> = [trackGuidedOnboardingEvent, fireGuidedOnboardingNurturing];

function fireGuidedOnboardingNurturing(
  event: AttributedGuidedOnboardingEvent,
): void {
  switch (event.event) {
    case "paths_selected":
    case "path_begun":
      fireGuidedOnboardingPathsNurturing({
        userId: event.userId,
        organizationId: event.organizationId,
        event: event.event,
        previousPaths: event.previous.paths,
        paths: event.state.paths,
      });
      return;
    case "provider_connected":
    case "tour_completed":
    case "tour_skipped":
    case "path_completed":
      fireGuidedOnboardingProgressNurturing({
        userId: event.userId,
        organizationId: event.organizationId,
        event: event.event,
        payload: event.payload,
        state: event.state,
      });
      return;
    default:
      return;
  }
}

/**
 * A write through a project credential has no user; the organization's first
 * admin stands in, the same person the first-trace milestone is tracked
 * against, so the events of one onboarding join one PostHog person.
 */
async function resolveOrganizationAdminUserId(
  organizationId: string,
): Promise<string | undefined> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId;
}
