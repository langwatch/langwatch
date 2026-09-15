import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { SignUpVerificationTokenRepository } from "./signup-verification.repository.ts";

/**
 * The two tables auth owns: the browser sessions a signed-in person holds, and
 * the confirmation tokens the signed-out door mints. Everything else the module
 * reads - the person, the organization, the invitation - belongs to another
 * module and arrives as a peer or as this process's own members.
 */
export interface AuthRepositories {
  readonly sessions: AuthSessionRepository;
  readonly signUpTokens: SignUpVerificationTokenRepository;
}
