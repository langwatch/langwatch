import { resolveAuthProvider } from "~/runtime/app/features/sso";
import { z } from "zod";
import { publicProcedure } from "../trpc";

const isOpsSidebarEmail = (
  userEmail: string | null | undefined,
  allowList: readonly string[] | undefined,
) => {
  if (!allowList?.length || !userEmail) return false;
  const normalized = userEmail.toLowerCase().trim();
  return allowList.includes(normalized);
};

/**
 * Transitional procedure name retained for API compatibility. Deployment
 * configuration no longer travels through it; only viewer/sign-in capability
 * decisions that cannot be globally embedded remain.
 */
export const publicEnvRouter = publicProcedure
  .input(z.object({}).passthrough())
  .noPermission({
    reason: "resolves sign-in mode and viewer UI visibility only; no tenant product data",
  })
  .query(async ({ ctx }) => {
    return {
      // ADR-027: report "email" whenever the license gate denies SSO, so
      // the sign-in page renders the email form and never auto-redirects to
      // a disabled IdP. `resolveAuthProvider()` is the single source of
      // truth — never read `env.NEXTAUTH_PROVIDER` directly here.
      NEXTAUTH_PROVIDER: await resolveAuthProvider(),
      SHOW_OPS_IN_MAIN_SIDEBAR: isOpsSidebarEmail(
        ctx.session?.user?.email,
        ctx.app.config.opsSidebarEmails,
      ),
    };
  });
