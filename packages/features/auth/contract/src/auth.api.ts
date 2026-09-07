import { featureApi } from "@langwatch/runtime-composition/contract";
import type { BrowserSession, VerifiedBrowserSession } from "./browser-session.ts";

/** The callable browser-session capability shared with process features. */
export interface AuthApi {
  tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null>;
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  revokeBrowserSession(input: { sessionId: string }): Promise<void>;
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;
}

export const AuthApi = featureApi<AuthApi>("auth");
