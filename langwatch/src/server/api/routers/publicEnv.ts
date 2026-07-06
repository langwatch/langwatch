import { z } from "zod";

import { env } from "../../../env.mjs";
import { resolveAuthProvider } from "../../sso/sso-gate";
import { skipPermissionCheck } from "../rbac";
import { publicProcedure } from "../trpc";

const isOpsSidebarEmail = (userEmail: string | null | undefined) => {
  const allowList = env.SHOW_OPS_IN_MAIN_SIDEBAR;
  if (!allowList || !userEmail) return false;
  const normalized = userEmail.toLowerCase().trim();
  return allowList
    .split(",")
    .some((e: string) => e.trim().toLowerCase() === normalized);
};

export const publicEnvRouter = publicProcedure
  .input(z.object({}).passthrough())
  .use(skipPermissionCheck)
  .query(async ({ ctx }) => {
    // Warning: be very careful with the env vars you expose here

    const publicEnvVars = {
      BASE_HOST: env.BASE_HOST,
      // ADR-027: report "email" whenever the license gate denies SSO, so
      // the sign-in page renders the email form and never auto-redirects to
      // a disabled IdP. `resolveAuthProvider()` is the single source of
      // truth — never read `env.NEXTAUTH_PROVIDER` directly here.
      NEXTAUTH_PROVIDER: await resolveAuthProvider(),
      DEMO_PROJECT_SLUG: env.DEMO_PROJECT_SLUG,
      NODE_ENV: env.NODE_ENV,

      HAS_EMAIL_PROVIDER_KEY:
        !!env.SENDGRID_API_KEY || !!(env.USE_AWS_SES && env.AWS_REGION),
      IS_SAAS: env.IS_SAAS,
      SHOW_OPS_IN_MAIN_SIDEBAR: isOpsSidebarEmail(ctx.session?.user?.email),
      POSTHOG_KEY: env.POSTHOG_KEY,
      POSTHOG_HOST: env.POSTHOG_HOST,
      HAS_LANGWATCH_NLP_SERVICE:
        !!env.LANGWATCH_NLP_SERVICE || !!env.LANGWATCH_NLP_LAMBDA_CONFIG,
      HAS_LANGEVALS_ENDPOINT: !!env.LANGEVALS_ENDPOINT,
      STRIPE_LICENSE_PAYMENT_LINK_URL: env.STRIPE_LICENSE_PAYMENT_LINK_URL,
    };

    return publicEnvVars;
  });
