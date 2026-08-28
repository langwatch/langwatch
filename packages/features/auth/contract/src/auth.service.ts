import type { BrowserSession, VerifiedBrowserSession } from "./browser-session";

/** The one browser-session lifecycle capability owned by Auth. */
export abstract class AuthService {
  /** A missing, revoked, expired, or unusable session resolves to null. */
  abstract tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null>;
  abstract revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  abstract revokeBrowserSession(input: { sessionId: string }): Promise<void>;
  abstract revokeOtherBrowserSessions(input: {
    userId: string;
    keepSessionId: string;
  }): Promise<void>;
}
