import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// @ts-ignore
const optionalIfBuildTime = (schema) => {
  return process.env.BUILD_TIME ? schema.optional() : schema;
};

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: optionalIfBuildTime(z.string().url()),
    NODE_ENV: z.enum(["development", "test", "production"]),
    BASE_HOST: optionalIfBuildTime(z.string().min(1)),
    NEXTAUTH_PROVIDER: z.enum(["auth0", "email", "azure-ad"]),
    NEXTAUTH_SECRET: optionalIfBuildTime(z.string().min(1)),
    NEXTAUTH_URL: optionalIfBuildTime(
      z.preprocess(
        // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
        // Since NextAuth.js automatically uses the VERCEL_URL if present.
        (str) => process.env.VERCEL_URL ?? str,
        // VERCEL_URL doesn't include `https` so it cant be validated as a URL
        process.env.VERCEL ? z.string().min(1) : z.string().url()
      )
    ),
    AUTH0_CLIENT_ID: z.string().optional(),
    AUTH0_CLIENT_SECRET: z.string().optional(),
    AUTH0_ISSUER: z.string().optional(),
    API_TOKEN_JWT_SECRET: optionalIfBuildTime(z.string().min(1)),
    ELASTICSEARCH_NODE_URL: optionalIfBuildTime(z.string().min(1)),
    ELASTICSEARCH_API_KEY: z.string().optional(),
    REDIS_URL: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    AZURE_OPENAI_ENDPOINT: z.string().optional(),
    AZURE_OPENAI_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    SENDGRID_API_KEY: z.string().optional(),
    LANGWATCH_NLP_SERVICE: z.string().optional(),
    TOPIC_CLUSTERING_SERVICE: z.string().optional(),
    LANGEVALS_ENDPOINT: z.string().optional(),
    DEMO_PROJECT_ID: z.string().optional(),
    DEMO_PROJECT_USER_ID: z.string().optional(),
    DEMO_PROJECT_SLUG: z.string().optional(),
    IS_OPENSEARCH: z.boolean().optional(),
    IS_QUICKWIT: z.boolean().optional(),
    USE_AWS_SES: z.string().optional(),
    AWS_REGION: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    EMAIL_DEFAULT_FROM: z.string().optional(),
    S3_KEY_SALT: z.string().optional(),
    IS_SAAS: z.boolean().optional(),
    USE_S3_STORAGE: z.boolean().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    DATASET_STORAGE_LOCAL: z.boolean().optional(),
    CREDENTIALS_SECRET: z.string().optional(),
    AZURE_CLIENT_ID: z.string().optional(),
    AZURE_CLIENT_SECRET: z.string().optional(),
    AZURE_TENANT_ID: z.string().optional(),
  },

  /**
   * DO NOT USE client-side env vars, they won't work, expose it on `publicEnv.ts` instead
   * NEXT_PUBLIC_ env vars are injected at build time, but we have to use the same build
   * for multiple environments before the infra setup, so that won't work.
   */
  client: {
    // DO NOT USE THIS, use `publicEnv.ts` instead
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    BASE_HOST: process.env.BASE_HOST,
    NEXTAUTH_PROVIDER: process.env.NEXTAUTH_PROVIDER ?? "email",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
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
    // Temporary, ideally we want to move this to lambda too
    TOPIC_CLUSTERING_SERVICE: process.env.TOPIC_CLUSTERING_SERVICE
      ? process.env.TOPIC_CLUSTERING_SERVICE
      : process.env.LANGWATCH_NLP_SERVICE,
    LANGEVALS_ENDPOINT: process.env.LANGEVALS_ENDPOINT,
    DEMO_PROJECT_ID: process.env.DEMO_PROJECT_ID,
    DEMO_PROJECT_USER_ID: process.env.DEMO_PROJECT_USER_ID,
    DEMO_PROJECT_SLUG: process.env.DEMO_PROJECT_SLUG,
    IS_OPENSEARCH:
      process.env.IS_OPENSEARCH === "1" ||
      process.env.IS_OPENSEARCH?.toLowerCase() === "true",
    IS_QUICKWIT:
      process.env.IS_QUICKWIT === "1" ||
      process.env.IS_QUICKWIT?.toLowerCase() === "true" ||
      process.env.ELASTICSEARCH_NODE_URL?.startsWith("quickwit://"),
    USE_AWS_SES: process.env.USE_AWS_SES,
    AWS_REGION: process.env.AWS_REGION,
    SENTRY_DSN: process.env.SENTRY_DSN,
    EMAIL_DEFAULT_FROM: process.env.EMAIL_DEFAULT_FROM,
    S3_KEY_SALT: process.env.S3_KEY_SALT,
    IS_SAAS:
      process.env.IS_SAAS === "1" ||
      process.env.IS_SAAS?.toLowerCase() === "true",
    USE_S3_STORAGE:
      process.env.USE_S3_STORAGE === "1" ||
      process.env.USE_S3_STORAGE?.toLowerCase() === "true",
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    DATASET_STORAGE_LOCAL:
      process.env.DATASET_STORAGE_LOCAL === "1" ||
      process.env.DATASET_STORAGE_LOCAL?.toLowerCase() === "true",
    CREDENTIALS_SECRET: process.env.CREDENTIALS_SECRET,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
    AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   * This is especially useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
