import type { Logger } from "@langwatch/observability";

import type { SignupAnnouncementService } from "./signup-announcement.service.ts";

/**
 * The trail a sign-up, an invitation and a chosen integration leave outside
 * this feature. Every one of them is fire-and-forget by construction: an
 * organization that could not be announced is still an organization.
 */
export interface OrganizationSignals {
  trackServerEvent(
    input: Readonly<{
      userId: string;
      event: string;
      properties?: Readonly<Record<string, unknown>>;
    }>,
  ): void;
  // sendSlackSignupEvent, sendHubspotSignupForm and reportError below are
  // properties of function type rather than method shorthand: tests hold a
  // mock built to this interface and assert on these members via
  // `expect(...).toHaveBeenCalledWith`, which is unsafe against a
  // method-shorthand member under `unbound-method`.
  sendSlackSignupEvent: (
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ) => Promise<void>;
  sendHubspotSignupForm: (
    input: Readonly<{
      userName?: string | null;
      userEmail: string | null;
      organizationName: string;
      phoneNumber?: string | undefined;
      signUpData?: Record<string, unknown> | undefined;
    }>,
  ) => Promise<void>;
  /** Never fatal: every caller of this is already on a non-fatal branch. */
  reportError: (
    error: unknown,
    context?: Readonly<{
      tags?: Readonly<Record<string, string>>;
      extra?: Readonly<Record<string, unknown>>;
    }>,
  ) => void;
}

/**
 * The sign-up announcement posts to our own Slack; no product-analytics sink
 * or marketing gateway is composed, so those say so at debug.
 */
export class OrganizationSignalsService {
  private constructor() {}

  static create({
    logger,
    signupAnnouncements,
  }: {
    logger: Pick<Logger, "debug" | "error">;
    signupAnnouncements: SignupAnnouncementService;
  }): OrganizationSignals {
    const unsent = (what: string) =>
      logger.debug(
        { signal: what },
        `no product-analytics sink is composed: ${what} is not recorded`,
      );

    return {
      trackServerEvent: (input) => unsent(`the organization event "${input.event}"`),
      sendSlackSignupEvent: (input) => signupAnnouncements.announce(input),
      sendHubspotSignupForm: async () => unsent("a sign-up form"),
      reportError: (error) => {
        logger.error({ error }, "an organization surface failed");
      },
    };
  }
}
