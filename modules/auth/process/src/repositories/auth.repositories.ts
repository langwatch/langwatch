import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { CliDeviceSessionRepository } from "./cli-device-session.repository.ts";
import type { SignUpVerificationTokenRepository } from "./signup-verification.repository.ts";

/**
 * Auth's browser-session rows, signup confirmation tokens, and TTL'd CLI
 * device sessions. Everything else it reads — person, organization, invitation
 * — belongs to another module and arrives as a peer or as this process's members.
 */
export interface AuthRepositories {
  readonly sessions: AuthSessionRepository;
  readonly cliSessions: CliDeviceSessionRepository;
  readonly signUpTokens: SignUpVerificationTokenRepository;
}
