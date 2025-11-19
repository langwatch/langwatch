import { z } from "zod";

import { env } from "../../../env.mjs";
import { skipPermissionCheck } from "../permission";
import { publicProcedure } from "../trpc";

export const publicEnvRouter = publicProcedure
  .input(z.object({}).passthrough())
  .use(skipPermissionCheck)
  .query(() => {
    // Warning: be very careful with the env vars you expose here

    const publicEnvVars = {
      BASE_HOST: env.BASE_HOST,
      NEXTAUTH_PROVIDER: env.NEXTAUTH_PROVIDER,
      DEMO_PROJECT_SLUG: env.DEMO_PROJECT_SLUG,
      NODE_ENV: env.NODE_ENV,
      IS_QUICKWIT: env.IS_QUICKWIT,
      HAS_EMAIL_PROVIDER_KEY:
        !!env.SENDGRID_API_KEY || !!(env.USE_AWS_SES && env.AWS_REGION),
      IS_SAAS: env.IS_SAAS,
      POSTHOG_KEY: env.POSTHOG_KEY,
      POSTHOG_HOST: env.POSTHOG_HOST,
      HAS_LANGWATCH_NLP_SERVICE:
        !!env.LANGWATCH_NLP_SERVICE || !!env.LANGWATCH_NLP_LAMBDA_CONFIG,
      HAS_LANGEVALS_ENDPOINT: !!env.LANGEVALS_ENDPOINT,
    };

    return publicEnvVars;
  });
