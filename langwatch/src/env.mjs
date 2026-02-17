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
    CLICKHOUSE_URL: z.string().url().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]),
    ENVIRONMENT: z.string().default("local"),
    BASE_HOST: optionalIfBuildTime(z.string().min(1)),
    NEXTAUTH_PROVIDER: z.string().optional(),
    NEXTAUTH_SECRET: optionalIfBuildTime(z.string().min(1)),
    NEXTAUTH_URL: optionalIfBuildTime(
      z.preprocess(
        // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
        // Since NextAuth.js automatically uses the VERCEL_URL if present.
        (str) => process.env.VERCEL_URL ?? str,
        // VERCEL_URL doesn't include `https` so it cant be validated as a URL
        process.env.VERCEL ? z.string().min(1) : z.string().url(),
      ),
    ),
    AUTH0_CLIENT_ID: z.string().optional(),
    AUTH0_CLIENT_SECRET: z.string().optional(),
    AUTH0_ISSUER: z.string().optional(),
    API_TOKEN_JWT_SECRET: optionalIfBuildTime(z.string().min(1)),
    ELASTICSEARCH_NODE_URL: optionalIfBuildTime(z.string().min(1)),
    ELASTICSEARCH_API_KEY: z.string().optional(),
    REDIS_URL: z.string().optional(),
    REDIS_CLUSTER_ENDPOINTS: z.string().optional(),
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
    AZURE_AD_CLIENT_ID: z.string().optional(),
    AZURE_AD_CLIENT_SECRET: z.string().optional(),
    AZURE_AD_TENANT_ID: z.string().optional(),

    // Cognito
    COGNITO_CLIENT_ID: z.string().optional(),
    COGNITO_ISSUER: z.string().optional(),
    COGNITO_CLIENT_SECRET: z.string().optional(),

    // Github
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // Gitlab
    GITLAB_CLIENT_ID: z.string().optional(),
    GITLAB_CLIENT_SECRET: z.string().optional(),

    // Google
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    // Okta
    OKTA_CLIENT_ID: z.string().optional(),
    OKTA_CLIENT_SECRET: z.string().optional(),
    OKTA_ISSUER: z.string().optional(),

    POSTHOG_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().optional(),
    DISABLE_USAGE_STATS: z.boolean().optional(),
    LANGWATCH_NLP_LAMBDA_CONFIG: z.string().optional(),

    // Observability
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

    // Event Sourcing
    ENABLE_EVENT_SOURCING: z.boolean().optional(),
    ENABLE_CLICKHOUSE: z.boolean().optional(),

    // ClickHouse Migration Configuration
    CLICKHOUSE_CLUSTER: z.string().optional(),

    LANGWATCH_LICENSE_PUBLIC_KEY: z.string().optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    ADMIN_EMAILS: z.string().optional(),
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
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ENVIRONMENT: process.env.ENVIRONMENT,
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
    REDIS_CLUSTER_ENDPOINTS: process.env.REDIS_CLUSTER_ENDPOINTS,
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
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET,
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    COGNITO_ISSUER: process.env.COGNITO_ISSUER,
    COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    DISABLE_USAGE_STATS:
      process.env.DISABLE_USAGE_STATS === "1" ||
      process.env.DISABLE_USAGE_STATS?.toLowerCase() === "true",
    LANGWATCH_NLP_LAMBDA_CONFIG: process.env.LANGWATCH_NLP_LAMBDA_CONFIG,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITLAB_CLIENT_ID: process.env.GITLAB_CLIENT_ID,
    GITLAB_CLIENT_SECRET: process.env.GITLAB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    OKTA_CLIENT_ID: process.env.OKTA_CLIENT_ID,
    OKTA_CLIENT_SECRET: process.env.OKTA_CLIENT_SECRET,
    OKTA_ISSUER: process.env.OKTA_ISSUER,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    ENABLE_EVENT_SOURCING:
      process.env.ENABLE_EVENT_SOURCING === "true" ||
      process.env.ENABLE_EVENT_SOURCING?.toLowerCase() === "true",
    ENABLE_CLICKHOUSE:
      process.env.ENABLE_CLICKHOUSE === "true" ||
      process.env.ENABLE_CLICKHOUSE?.toLowerCase() === "true",
    CLICKHOUSE_CLUSTER: process.env.CLICKHOUSE_CLUSTER,
    LANGWATCH_LICENSE_PUBLIC_KEY: process.env.LANGWATCH_LICENSE_PUBLIC_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
   * This is especially useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
