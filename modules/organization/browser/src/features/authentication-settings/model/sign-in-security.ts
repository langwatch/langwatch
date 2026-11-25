import type { SignInSecuritySettings } from "@langwatch/auth-contract";

/** Both rules off: what an organization that never set one reads. */
export const SIGN_IN_SECURITY_OFF: SignInSecuritySettings = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

/** What a save tells the administrator, naming the sessions it ended. */
export function savedSessionMessage(sweptSessions: number): string {
  if (!(sweptSessions > 0)) return "Saved.";

  const sessions = sweptSessions === 1 ? "session" : "sessions";
  const verb = sweptSessions === 1 ? "has" : "have";
  return `Saved. ${sweptSessions} ${sessions} already idle past the new limit ${verb} been signed out.`;
}
