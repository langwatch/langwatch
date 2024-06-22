import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]),
    BASE_HOST: z.string().min(1),
    NEXTAUTH_SECRET:
      process.env.NODE_ENV === "production" &&
      !process.env.BASE_HOST?.startsWith("http://localhost")
        ? z.string().min(1)
        : z.string().optional(),
    NEXTAUTH_URL: z.preprocess(
      // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
      // Since NextAuth.js automatically uses the VERCEL_URL if present.
      (str) => process.env.VERCEL_URL ?? str,
      // VERCEL_URL doesn't include `https` so it cant be validated as a URL
      process.env.VERCEL ? z.string().min(1) : z.string().url()
    ),
    AUTH0_CLIENT_ID: z.string().optional(),
    AUTH0_CLIENT_SECRET: z.string().optional(),
    AUTH0_ISSUER: z.string().optional(),
    API_TOKEN_JWT_SECRET: z.string().min(1),
    ELASTICSEARCH_NODE_URL: z.string().min(1),
    ELASTICSEARCH_API_KEY: z.string().min(1),
    REDIS_URL: z.string().min(1),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    AZURE_OPENAI_ENDPOINT: z.string().optional(),
    AZURE_OPENAI_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    SENDGRID_API_KEY: z.string().optional(),
    LANGWATCH_NLP_SERVICE: z.string().min(1),
    LANGEVALS_ENDPOINT: z.string().min(1),
    DEMO_PROJECT_ID: z.string().optional(),
    DEMO_PROJECT_USER_ID: z.string().optional(),
    DEMO_PROJECT_SLUG: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_AUTH_PROVIDER: z.enum(["auth0", "email"]),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    BASE_HOST: process.env.BASE_HOST,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.BASE_HOST, // same as BASE_HOST
    NEXT_PUBLIC_AUTH_PROVIDER: process.env.NEXT_PUBLIC_AUTH_PROVIDER,
    AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
    AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
    AUTH0_ISSUER: process.env.AUTH0_ISSUER,
    API_TOKEN_JWT_SECRET: process.env.API_TOKEN_JWT_SECRET,
    ELASTICSEARCH_NODE_URL: process.env.ELASTICSEARCH_NODE_URL,
    ELASTICSEARCH_API_KEY: process.env.ELASTICSEARCH_API_KEY,
    REDIS_URL: process.env.REDIS_URL,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    LANGWATCH_NLP_SERVICE: process.env.LANGWATCH_NLP_SERVICE,
    LANGEVALS_ENDPOINT: process.env.LANGEVALS_ENDPOINT,
    DEMO_PROJECT_ID: process.env.DEMO_PROJECT_ID,
    DEMO_PROJECT_USER_ID: process.env.DEMO_PROJECT_USER_ID,
    DEMO_PROJECT_SLUG: process.env.DEMO_PROJECT_SLUG,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   * This is especially useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
