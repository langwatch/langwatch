import type { Instant } from "@langwatch/time";

export interface ImpersonationTarget {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  deactivatedAt: Instant | null;
  /**
   * The target's organizations that require a second factor. Their data is
   * what the operator is about to see, so they are what decides whether the
   * operator needs one of their own.
   */
  mfaRequiredOrganizationSlugs: string[];
}

export interface ImpersonationWindow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  expires: Instant;
}

export abstract class ImpersonationRepository {
  /** Throws `user_to_impersonate_not_found` when no such person exists. */
  abstract getTarget(userId: string): Promise<ImpersonationTarget>;
  /** Whether this person can prove a second factor on their own account. */
  abstract hasSecondFactor(userId: string): Promise<boolean>;
  /** The window this session carries, expired or not — the service decides. */
  abstract findWindow(sessionId: string): Promise<ImpersonationWindow | null>;
  abstract setWindow(sessionId: string, window: ImpersonationWindow): Promise<void>;
  abstract clearWindow(sessionId: string): Promise<void>;
}
