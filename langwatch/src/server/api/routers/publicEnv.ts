import { z } from "zod";
import { skipPermissionCheck } from "../permission";
import { publicProcedure } from "../trpc";
import { env } from "../../../env.mjs";

export const publicEnvRouter = publicProcedure
  .input(z.object({}).passthrough())
  .use(skipPermissionCheck)
  .query(() => {
    // Warning: be very careful with the env vars you expose here

    const publicEnvVars = {
      NEXTAUTH_PROVIDER: env.NEXTAUTH_PROVIDER,
      DEMO_PROJECT_SLUG: env.DEMO_PROJECT_SLUG,
      NODE_ENV: env.NODE_ENV,
      SENTRY_DSN: env.SENTRY_DSN,
      IS_QUICKWIT: env.IS_QUICKWIT,
      HAS_EMAIL_PROVIDER_KEY:
        !!env.SENDGRID_API_KEY || !!(env.USE_AWS_SES && env.AWS_REGION),
      IS_SAAS: env.IS_SAAS,
    };

    return publicEnvVars;
  });
