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
      process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().min(1).optional(),
    NEXTAUTH_URL: z.preprocess(
      // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
      // Since NextAuth.js automatically uses the VERCEL_URL if present.
      (str) => process.env.VERCEL_URL ?? str,
      // VERCEL_URL doesn't include `https` so it cant be validated as a URL
      process.env.VERCEL ? z.string().min(1) : z.string().url()
    ),
    AUTH0_CLIENT_ID: z.string().min(1),
    AUTH0_CLIENT_SECRET: z.string().min(1),
    AUTH0_ISSUER: z.string().min(1),
    API_TOKEN_JWT_SECRET: z.string().min(1),
    ELASTICSEARCH_NODE_URL: z.string().min(1),
    ELASTICSEARCH_API_KEY: z.string().min(1),
    REDIS_URL: z.string().min(1),
    GOOGLE_CREDENTIALS_JSON: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    SENDGRID_API_KEY: z.string().min(1).optional(),
    TOPIC_CLUSTERING_SERVICE_URL: z.string().min(1).optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string().min(1),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    BASE_HOST:
      process.env.NODE_ENV === "production"
        ? "https://app.langwatch.ai"
        : "http://localhost:3000",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
    AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
    AUTH0_ISSUER: process.env.AUTH0_ISSUER,
    API_TOKEN_JWT_SECRET: process.env.API_TOKEN_JWT_SECRET,
    ELASTICSEARCH_NODE_URL: process.env.ELASTICSEARCH_NODE_URL,
    ELASTICSEARCH_API_KEY: process.env.ELASTICSEARCH_API_KEY,
    REDIS_URL: process.env.REDIS_URL,
    GOOGLE_CREDENTIALS_JSON: process.env.GOOGLE_CREDENTIALS_JSON,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    TOPIC_CLUSTERING_SERVICE_URL: process.env.TOPIC_CLUSTERING_SERVICE_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   * This is especially useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
