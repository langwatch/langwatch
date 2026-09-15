import type { env } from "~/env.mjs";

/**
 * Whether this deployment MOUNTS the email/password routes at all.
 *
 * On SaaS they mount only in native `email` mode: the original NextAuth code
 * mounted EITHER a social provider OR CredentialsProvider, never both, so
 * users could not bypass the configured SSO. This gate mirrors that
 * invariant. Self-hosted always mounts them, even beside an enterprise
 * identity provider, so a denied (unlicensed) deployment has a working
 * coerced email door and a licensed install keeps password-reset
 * self-recovery reachable (ADR-027).
 *
 * WHY IT LIVES IN ITS OWN MODULE rather than beside the better-auth options
 * it configures. Two very different callers need this one fact, and the other
 * one is the sign-in method policy — which decides whether a break-glass
 * grant has a door to be a way in through. Importing the better-auth config
 * to ask would pull bcrypt, better-auth and the react-email mailer into the
 * policy's graph, and that graph is reached from most of the server. The
 * predicate is three lines of env and belongs where both can read it without
 * dragging the machinery along.
 */
export const isEmailPasswordEnabled = (
  e: Pick<typeof env, "NEXTAUTH_PROVIDER" | "IS_SAAS">,
): boolean => e.NEXTAUTH_PROVIDER === "email" || !e.IS_SAAS;
