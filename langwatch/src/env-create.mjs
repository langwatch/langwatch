import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Zod validators for the three AI Gateway secrets.
 * Exported so tests can exercise the real `min(32)` constraint directly,
 * catching mutations like `min(32) → min(1)` without relying on process.env
 * stubbing or full-stack module reloads.
 */
export const gatewaySecretsSchema = {
  LW_GATEWAY_INTERNAL_SECRET: z.string().min(32).optional(),
  LW_GATEWAY_JWT_SECRET: z.string().min(32).optional(),
  LW_VIRTUAL_KEY_PEPPER: z.string().min(32).optional(),
};

/** @param {import('zod').ZodTypeAny} schema */
const optionalIfBuildTime = (schema) => {
  return process.env.BUILD_TIME ? schema.optional() : schema;
};

// Memoize so double calls (env.mjs root + createAppConfigFromEnv) only validate once
/** @type {any} */
let _env = null;

export function createEnvConfig() {
  if (_env) return _env;

  _env = createEnv({
    // clientPrefix required by env-core to distinguish client/server vars
    // (env-nextjs set this to "NEXT_PUBLIC_" automatically)
    clientPrefix: "VITE_PUBLIC_",
    client: {},
    server: {
      DATABASE_URL: optionalIfBuildTime(z.string().url()),
      CLICKHOUSE_URL: z.string().url().optional(),
      NODE_ENV: z.enum(["development", "test", "production"]),
      ENVIRONMENT: z.string().optional().transform((val) => {
        if (val) return val;
        if (process.env.NODE_ENV === "production") {
          console.warn("ENVIRONMENT is not set in production. Defaulting to 'local'.");
        }

        return "local";
      }),
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
      // Separate Machine-to-Machine application credentials for Auth0
      // Management API access (e.g. password changes via PATCH /users).
      // The user-login application is typically a Single Page Application
      // and cannot use the client_credentials grant. When unset, the
      // service falls back to AUTH0_CLIENT_ID/SECRET (works only when
      // the login app is a Regular Web Application with Client
      // Credentials enabled — uncommon).
      AUTH0_MGMT_CLIENT_ID: z.string().optional(),
      AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),
      API_TOKEN_JWT_SECRET: optionalIfBuildTime(z.string().min(1)),
      // Shared HMAC secret between control-plane and the Go AI Gateway service.
      // See specs/ai-gateway/_shared/contract.md §4 + §9.
      LW_GATEWAY_INTERNAL_SECRET: gatewaySecretsSchema.LW_GATEWAY_INTERNAL_SECRET,
      // HS256 secret used by control-plane to sign the short-lived JWT that the
      // gateway verifies on every request (contract §4.1). 32+ chars.
      LW_GATEWAY_JWT_SECRET: gatewaySecretsSchema.LW_GATEWAY_JWT_SECRET,
      // Public-facing base URL the AI Gateway is reachable at. The Go
      // gateway re-uses this same var name in the OPPOSITE direction
      // (gateway -> control plane), so in dev `scripts/start.sh` hijacks
      // it for the Go interpretation. That collision means the TS side
      // (CLI bootstrap, /me VK reveal) must NOT read this var directly
      // when LW_GATEWAY_PUBLIC_URL is set; prefer that instead. Kept
      // here for back-compat with hosted SaaS deploys where the value
      // is correctly the public gateway URL.
      LW_GATEWAY_BASE_URL: z.string().url().optional(),
      // Public-facing data plane URL the CLI + /me VK reveal cards
      // surface to the user. Distinct from LW_GATEWAY_BASE_URL because
      // the Go gateway hijacks that name for its control-plane
      // discovery; this var stays unambiguous on the TS read path. In
      // dev: http://localhost:5563 (or `PORT + 3` when PORT is set);
      // hosted SaaS: https://gateway.langwatch.com. Falls back to
      // LW_GATEWAY_BASE_URL when unset for legacy deploys.
      LW_GATEWAY_PUBLIC_URL: z.string().url().optional(),
      // Internal control-plane → gateway URL for the HMAC-signed
      // /internal/* surface (validate-ottl, transform). Different from
      // LW_GATEWAY_BASE_URL because the Go gateway re-uses that name
      // for the OPPOSITE direction (gateway → control plane), so a
      // shared `.env` would otherwise collide. In dev:
      // http://localhost:5563. In Docker: http://host.docker.internal:5563.
      // Falls back to LW_GATEWAY_BASE_URL when unset for back-compat.
      LW_GATEWAY_INTERNAL_URL: z.string().url().optional(),
      // Argon2id pepper mixed into virtual-key hashing. Rotating this
      // invalidates all existing VKs — treat as append-only / key-management.
      LW_VIRTUAL_KEY_PEPPER: gatewaySecretsSchema.LW_VIRTUAL_KEY_PEPPER,
      REDIS_URL: z.string().optional(),
      REDIS_CLUSTER_ENDPOINTS: z.string().optional(),
      REDIS_DB_INDEX: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z
          .string()
          .regex(/^(?:[0-9]|1[0-5])$/, "REDIS_DB_INDEX must be 0-15")
          .optional(),
      ),
      GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
      AZURE_OPENAI_ENDPOINT: z.string().optional(),
      AZURE_OPENAI_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      SENDGRID_API_KEY: z.string().optional(),
      LANGWATCH_NLP_SERVICE: z.string().optional(),
      LANGEVALS_ENDPOINT: z.string().optional(),
      // S3 staging for outbound langevals POSTs is opt-in: only relevant
      // when langevals is fronted by AWS Lambda (6 MB sync-invoke cap).
      // Self-hosted langevals on a plain HTTP service has no such cap,
      // so leave LANGEVALS_STAGING_THRESHOLD_BYTES unset and bodies
      // always go inline. When set, bodies above the threshold are
      // uploaded to S3 and the GET presigned URL is forwarded via
      // X-Payload-S3-URL. EVAL_MAX_PAYLOAD_BYTES and
      // TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES are hard upper bounds —
      // anything larger is rejected before any network call.
      // LANGEVALS_STAGING_TTL_SECONDS bounds how long the presigned URL
      // stays valid; keep it short so a leaked URL doesn't grant
      // long-window access.
      LANGEVALS_STAGING_THRESHOLD_BYTES: z.coerce.number().int().positive().optional(),
      LANGEVALS_STAGING_TTL_SECONDS: z.coerce.number().int().positive().default(600),
      EVAL_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(16_000_000),
      TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(180_000_000),
      // ADR-031: per-trigger hourly hard cap on dispatched trigger emails.
      // Counts dispatches (one digest of N traces = 1), not traces or
      // recipients. Only ever bites immediate-cadence triggers; digest
      // cadences cannot exceed 12/hour.
      TRIGGER_EMAIL_HOURLY_CAP: z.coerce.number().int().positive().default(100),
      // ADR-031: per-PROJECT daily hard cap — a backstop ABOVE the per-trigger
      // hourly cap, bounding the aggregate trigger-email volume a whole project
      // can emit in 24h (SES sender-reputation protection). Counts RECIPIENTS
      // (actual outbound email volume), not dispatches.
      TRIGGER_EMAIL_TENANT_DAILY_CAP: z.coerce.number().int().positive().default(10000),
      DEMO_PROJECT_ID: z.string().optional(),
      DEMO_PROJECT_USER_ID: z.string().optional(),
      DEMO_PROJECT_SLUG: z.string().optional(),
      USE_AWS_SES: z.string().optional(),
      AWS_REGION: z.string().optional(),
      EMAIL_DEFAULT_FROM: z.string().optional(),
      S3_KEY_SALT: z.string().optional(),
      IS_SAAS: z.boolean().optional(),
      // Controls SSRF blocking for outbound HTTP calls (TS proxy + scenario
      // runner; mirrored on the Python NLP side via the same env name). When
      // true: private IPs, localhost, and hostnames resolving to private IPs
      // are blocked unless listed in ALLOWED_PROXY_HOSTS. When unset/false:
      // local destinations are allowed (cloud metadata is still always
      // blocked). Default: false.
      BLOCK_LOCAL_HTTP_CALLS: z.boolean().optional(),
      ALLOWED_PROXY_HOSTS: z.string().optional(),
      SHOW_OPS_IN_MAIN_SIDEBAR: z.string().optional(),
      // Post-2026-05-11 loop-prevention kill-switch. Set to "1" to
      // bypass the reactor depth check; emergency rollback only.
      LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: z.string().optional(),
      // Post-2026-05-11 tenant soft-cap: max in-flight event-sourcing
      // groups per tenant in the DISPATCH_LUA scheduler.
      // Default 100 (≈ one worker pod's concurrency) — every install
      // gets noisy-neighbour protection out of the box. Set to "0" to
      // disable entirely (incident kill switch). Set to a positive int
      // to retune (e.g. raise for a legitimate heavy single-tenant
      // workload).
      LANGWATCH_DISPATCH_TENANT_CAP: z.string().optional(),
      // Post-2026-05-29 dynamic water-level cap (option C). Global in-flight
      // budget = the fleet ceiling (pods x GLOBAL_QUEUE_CONCURRENCY) that the
      // water-fill divides across competing tenants, so a lone tenant bursts to
      // the full fleet and N contenders converge to a max-min fair share. Unset
      // or "0" (default) keeps the fixed LANGWATCH_DISPATCH_TENANT_CAP behaviour
      // — the feature ships inert and is enabled per-environment.
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: z.string().optional(),
      USE_S3_STORAGE: z.boolean().optional(),
      S3_ENDPOINT: z.string().optional(),
      S3_ACCESS_KEY_ID: z.string().optional(),
      S3_SECRET_ACCESS_KEY: z.string().optional(),
      // Optional STS session token. Required for temporary credentials
      // (SSO local dev, STS:AssumeRole, etc.). For long-lived IAM-user
      // keys this stays unset.
      S3_SESSION_TOKEN: z.string().optional(),
      // AWS region for the S3 client. The legacy default "auto" is the
      // R2 / MinIO convention; real AWS S3 needs a real region
      // (eu-central-1, us-east-1, etc.) or SigV4 fails with
      // SignatureDoesNotMatch.
      S3_REGION: z.string().optional(),
      S3_BUCKET_NAME: z.string().optional(),
      // Root path used by the stored-objects LocalFilesystemDriver when S3 is
      // not configured. Defaults to /var/lib/langwatch/objects inside the
      // service. Self-hosting operators running multi-pod deployments MUST
      // configure object storage instead — the local-FS path is dev-only.
      LANGWATCH_LOCAL_STORAGE_PATH: z.string().optional(),
      // Azure Blob Storage — optional alternative to S3 for stored-objects.
      // Set all three together; AZURE_BLOB_ENDPOINT only needs to be set for
      // emulator or sovereign-cloud deployments (e.g. Azurite, Azure Gov).
      AZURE_BLOB_ACCOUNT_NAME: z.string().optional(),
      AZURE_BLOB_ACCOUNT_KEY: z.string().optional(),
      AZURE_BLOB_ENDPOINT: z.string().optional(),
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
      // Feature Flags Secure API key (phs_*) — or a legacy Personal API key
      // (phx_*) — enables local feature flag evaluation in posthog-node. When
      // set, server-side `isFeatureEnabled` does NOT hit /flags per call;
      // instead the SDK polls flag definitions periodically and evaluates
      // locally. See https://posthog.com/docs/feature-flags/local-evaluation
      POSTHOG_FEATURE_FLAGS_KEY: z.string().optional(),
      // Polling interval (ms) for local flag definition refresh. PostHog default
      // is 30s; we default to 5min because each poll counts as 10 flag evaluations
      // for billing. Lower this if you need flag changes to propagate faster.
      // Empty-string values in .env are coerced to undefined so they fall back
      // to the runtime default instead of failing .positive() with 0.
      POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.coerce.number().int().positive().optional(),
      ),
      DISABLE_USAGE_STATS: z.boolean().optional(),
      LANGWATCH_NLP_LAMBDA_CONFIG: z.string().optional(),

      // Observability
      OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

      // ClickHouse Migration Configuration
      CLICKHOUSE_CLUSTER: z.string().optional(),

      LANGWATCH_LICENSE_PUBLIC_KEY: z.string().optional(),
      LANGWATCH_LICENSE_PRIVATE_KEY: z.string().optional(),

      // Stripe
      STRIPE_SECRET_KEY: z.string().optional(),
      STRIPE_WEBHOOK_SECRET: z.string().optional(),
      STRIPE_LICENSE_PAYMENT_LINK_ID: z.string().optional(),
      STRIPE_LICENSE_PAYMENT_LINK_URL: z.string().optional(),
      ADMIN_EMAILS: z.string().optional(),
      HUBSPOT_PORTAL_ID: z.string().optional(),
      HUBSPOT_REACHED_LIMIT_FORM_ID: z.string().optional(),
      HUBSPOT_FORM_ID: z.string().optional(),

      // Customer.io Nurturing
      CUSTOMER_IO_API_KEY: z.string().optional(),
      CUSTOMER_IO_REGION: z.enum(["us", "eu"]).optional(),

      // Notifications
      SLACK_PLAN_LIMIT_CHANNEL: z.string().optional(),
      SLACK_CHANNEL_SIGNUPS: z.string().optional(),
      SLACK_CHANNEL_SUBSCRIPTIONS: z.string().optional(),

      // SCIM
      AUTH0_SCIM_WEBHOOK_SECRET: z.string().optional(),
    },

    // No client-side env vars — use `publicEnv.ts` instead.
    // Runtime env values — must be destructured explicitly.
    runtimeEnv: {
      DATABASE_URL: process.env.DATABASE_URL,
      CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
      NODE_ENV: process.env.NODE_ENV,
      ENVIRONMENT: process.env.ENVIRONMENT,
      BASE_HOST: process.env.BASE_HOST,
      NEXTAUTH_PROVIDER: process.env.NEXTAUTH_PROVIDER ?? "email",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL,
      LW_GATEWAY_INTERNAL_SECRET: process.env.LW_GATEWAY_INTERNAL_SECRET,
      LW_GATEWAY_JWT_SECRET: process.env.LW_GATEWAY_JWT_SECRET,
      LW_GATEWAY_BASE_URL: process.env.LW_GATEWAY_BASE_URL,
      LW_GATEWAY_PUBLIC_URL: process.env.LW_GATEWAY_PUBLIC_URL,
      LW_GATEWAY_INTERNAL_URL: process.env.LW_GATEWAY_INTERNAL_URL,
      LW_VIRTUAL_KEY_PEPPER: process.env.LW_VIRTUAL_KEY_PEPPER,
      AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
      AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
      AUTH0_ISSUER: process.env.AUTH0_ISSUER,
      AUTH0_MGMT_CLIENT_ID: process.env.AUTH0_MGMT_CLIENT_ID,
      AUTH0_MGMT_CLIENT_SECRET: process.env.AUTH0_MGMT_CLIENT_SECRET,
      API_TOKEN_JWT_SECRET: process.env.API_TOKEN_JWT_SECRET,
      REDIS_URL: process.env.REDIS_URL,
      REDIS_CLUSTER_ENDPOINTS: process.env.REDIS_CLUSTER_ENDPOINTS,
      REDIS_DB_INDEX: process.env.REDIS_DB_INDEX,
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
      LANGWATCH_NLP_SERVICE: process.env.LANGWATCH_NLP_SERVICE,
      LANGEVALS_ENDPOINT: process.env.LANGEVALS_ENDPOINT,
      LANGEVALS_STAGING_THRESHOLD_BYTES: process.env.LANGEVALS_STAGING_THRESHOLD_BYTES,
      LANGEVALS_STAGING_TTL_SECONDS: process.env.LANGEVALS_STAGING_TTL_SECONDS,
      EVAL_MAX_PAYLOAD_BYTES: process.env.EVAL_MAX_PAYLOAD_BYTES,
      TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: process.env.TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES,
      TRIGGER_EMAIL_HOURLY_CAP: process.env.TRIGGER_EMAIL_HOURLY_CAP,
      TRIGGER_EMAIL_TENANT_DAILY_CAP: process.env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
      DEMO_PROJECT_ID: process.env.DEMO_PROJECT_ID,
      DEMO_PROJECT_USER_ID: process.env.DEMO_PROJECT_USER_ID,
      DEMO_PROJECT_SLUG: process.env.DEMO_PROJECT_SLUG,
      USE_AWS_SES: process.env.USE_AWS_SES,
      AWS_REGION: process.env.AWS_REGION,
      EMAIL_DEFAULT_FROM: process.env.EMAIL_DEFAULT_FROM,
      S3_KEY_SALT: process.env.S3_KEY_SALT,
      IS_SAAS:
        process.env.IS_SAAS === "1" ||
        process.env.IS_SAAS?.toLowerCase() === "true",
      BLOCK_LOCAL_HTTP_CALLS:
        process.env.BLOCK_LOCAL_HTTP_CALLS === "1" ||
        process.env.BLOCK_LOCAL_HTTP_CALLS?.toLowerCase() === "true",
      ALLOWED_PROXY_HOSTS: process.env.ALLOWED_PROXY_HOSTS,
      SHOW_OPS_IN_MAIN_SIDEBAR: process.env.SHOW_OPS_IN_MAIN_SIDEBAR,
      LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD:
        process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD,
      LANGWATCH_DISPATCH_TENANT_CAP: process.env.LANGWATCH_DISPATCH_TENANT_CAP,
      LANGWATCH_DISPATCH_GLOBAL_BUDGET:
        process.env.LANGWATCH_DISPATCH_GLOBAL_BUDGET,
      USE_S3_STORAGE:
        process.env.USE_S3_STORAGE === "1" ||
        process.env.USE_S3_STORAGE?.toLowerCase() === "true",
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
      S3_REGION: process.env.S3_REGION,
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
      LANGWATCH_LOCAL_STORAGE_PATH: process.env.LANGWATCH_LOCAL_STORAGE_PATH,
      AZURE_BLOB_ACCOUNT_NAME: process.env.AZURE_BLOB_ACCOUNT_NAME,
      AZURE_BLOB_ACCOUNT_KEY: process.env.AZURE_BLOB_ACCOUNT_KEY,
      AZURE_BLOB_ENDPOINT: process.env.AZURE_BLOB_ENDPOINT,
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
      POSTHOG_FEATURE_FLAGS_KEY: process.env.POSTHOG_FEATURE_FLAGS_KEY,
      POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS:
        process.env.POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS,
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
      CLICKHOUSE_CLUSTER: process.env.CLICKHOUSE_CLUSTER,
      LANGWATCH_LICENSE_PUBLIC_KEY: process.env.LANGWATCH_LICENSE_PUBLIC_KEY,
      LANGWATCH_LICENSE_PRIVATE_KEY: process.env.LANGWATCH_LICENSE_PRIVATE_KEY,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_LICENSE_PAYMENT_LINK_ID: process.env.STRIPE_LICENSE_PAYMENT_LINK_ID,
      STRIPE_LICENSE_PAYMENT_LINK_URL: process.env.STRIPE_LICENSE_PAYMENT_LINK_URL,
      ADMIN_EMAILS: process.env.ADMIN_EMAILS,
      HUBSPOT_PORTAL_ID: process.env.HUBSPOT_PORTAL_ID,
      HUBSPOT_REACHED_LIMIT_FORM_ID: process.env.HUBSPOT_REACHED_LIMIT_FORM_ID,
      HUBSPOT_FORM_ID: process.env.HUBSPOT_FORM_ID,
      CUSTOMER_IO_API_KEY: process.env.CUSTOMER_IO_API_KEY,
      CUSTOMER_IO_REGION: process.env.CUSTOMER_IO_REGION,
      SLACK_PLAN_LIMIT_CHANNEL: process.env.SLACK_PLAN_LIMIT_CHANNEL,
      SLACK_CHANNEL_SIGNUPS: process.env.SLACK_CHANNEL_SIGNUPS,
      SLACK_CHANNEL_SUBSCRIPTIONS: process.env.SLACK_CHANNEL_SUBSCRIPTIONS,
      AUTH0_SCIM_WEBHOOK_SECRET: process.env.AUTH0_SCIM_WEBHOOK_SECRET,
    },
    /**
     * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
     * This is especially useful for Docker builds.
     */
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  });

  // Server-side only: the validated env proxy from `createEnv()` throws
  // "Attempted to access a server-side environment variable on the client"
  // if we touch any of these keys from the browser bundle. Read from
  // process.env directly and skip the guard entirely when we're being
  // imported into a client bundle (typeof window !== "undefined").
  if (
    typeof window === "undefined" &&
    !process.env.SKIP_ENV_VALIDATION &&
    !process.env.BUILD_TIME
  ) {
    if (
      (process.env.IS_SAAS === "1" ||
        process.env.IS_SAAS?.toLowerCase() === "true") &&
      !(
        process.env.BLOCK_LOCAL_HTTP_CALLS === "1" ||
        process.env.BLOCK_LOCAL_HTTP_CALLS?.toLowerCase() === "true"
      )
    ) {
      throw new Error(
        "IS_SAAS=true requires BLOCK_LOCAL_HTTP_CALLS=true to keep SSRF protections enabled",
      );
    }
    assertGatewaySecretsAllOrNone(process.env);
  }

  return _env;
}

/**
 * Cross-field guard on AI Gateway secrets. Each secret is individually
 * `.optional()` so deployments that don't use the gateway pass clean —
 * but a deployment that sets two of three is a latent bug that only
 * surfaces minutes after startup when the first VK request hits
 * /api/internal/gateway/* and returns 503 auth_upstream_unavailable.
 *
 * Lives here instead of in start.ts so workers, CLI scripts, and every
 * other code path that imports env gets the same assertion at boot
 * (start.ts already ran this pre-a50e5266f; moving it here covers
 * workers.ts which otherwise boots through only verifyRedisReady).
 *
 * @param {Record<string, unknown>} env
 */
export function assertGatewaySecretsAllOrNone(env) {
  const gwSecrets = {
    LW_VIRTUAL_KEY_PEPPER: env.LW_VIRTUAL_KEY_PEPPER,
    LW_GATEWAY_INTERNAL_SECRET: env.LW_GATEWAY_INTERNAL_SECRET,
    LW_GATEWAY_JWT_SECRET: env.LW_GATEWAY_JWT_SECRET,
  };
  const set = Object.entries(gwSecrets).filter(([, v]) => !!v);
  const missing = Object.entries(gwSecrets)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (set.length > 0 && missing.length > 0) {
    const banner = [
      "",
      "========================================================================",
      "AI Gateway secrets are partially configured.",
      `  Missing: ${missing.join(", ")}`,
      "  Either set ALL three secrets (see langwatch/.env.example) or UNSET",
      "  them all. Partial config leaves /api/internal/gateway/* returning",
      "  503 auth_upstream_unavailable at request time.",
      "  Generate each value with: openssl rand -hex 32",
      "========================================================================",
      "",
    ].join("\n");
    // eslint-disable-next-line no-console
    console.error(banner);
    throw new Error(
      `AI Gateway secrets partial config (missing: ${missing.join(", ")})`,
    );
  }
}
