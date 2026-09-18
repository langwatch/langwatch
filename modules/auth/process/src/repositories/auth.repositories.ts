import type { AuthSessionRepository } from "./auth-session.repository.ts";
import type { SignUpVerificationTokenRepository } from "./signup-verification.repository.ts";

/**
 * The two tables auth owns: browser sessions and signup confirmation tokens.
 * Everything else it reads — person, organization, invitation — belongs to
 * another module and arrives as a peer or as this process's own members.
 */
export interface AuthRepositories {
  readonly sessions: AuthSessionRepository;
  readonly signUpTokens: SignUpVerificationTokenRepository;
}
