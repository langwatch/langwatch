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

/**
 * Share of browser *sessions* recorded, 0..1. Sessions rather than traces so a
 * recorded visit is complete; the decision also reaches the server, which drops
 * the backend half of an unsampled browser trace. Defaults to all of them.
 * See ADR-058.
 *
 * Blank in .env means "unset" — without the preprocess, `z.coerce` turns `""`
 * into 0 and silently records nothing.
 *
 * A meaningless value falls back to recording everything rather than failing
 * validation. Without the `catch`, `RUM_SAMPLE_RATIO=banana` (or `2`) refuses to
 * parse and takes the whole app down at boot — an optional telemetry dial is not
 * worth a deployment for, and the safe reading of nonsense is "record
 * everything", per the spec scenario "A nonsensical share records rather than
 * silently collecting nothing". An explicit `0` still means zero; only
 * unparseable and out-of-range values land on the fallback.
 *
 * Exported so tests exercise the real schema rather than an inline copy.
 */
export const rumSampleRatioSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().min(0).max(1).default(1).catch(1),
);

/**
 * Explicit stored-objects write-destination toggle (issue #4133). Constrained
 * to a known set of values — NOT a free string — so an unrecognized value
 * (typo, stale config) fails loud at boot, naming the variable and the
 * supported set, instead of silently falling through
 * `resolveProjectStorageDestination`'s precedence chain as if unset.
 *
 * Deliberately does NOT default to anything: absence means "let the
 * BYOC -> S3_BUCKET_NAME -> local-FS precedence decide", never "azure".
 * AZURE_BLOB_* presence alone must never flip the destination — only this
 * toggle does (issue #4133 rejected implicit env-presence inference).
 *
 * Exported so tests exercise the real schema rather than an inline copy.
 */
export const storedObjectsBackendSchema = z.enum(["s3", "azure"]).optional();

export const langyWorkerAgentUrlSchema = z.string().url().optional();

/**
 * Azure Blob authentication mode (issue #6087). An explicit toggle — never
 * inferred from which credential vars happen to be present, the same
 * reasoning that made `storedObjectsBackendSchema` explicit rather than
 * env-presence-inferred.
 *
 * `sharedKey` (default, unchanged from #4133) signs requests with
 * AZURE_BLOB_ACCOUNT_KEY. The three token modes exchange an OAuth bearer
 * token via @azure/identity instead of an HMAC signature:
 *   - `workloadIdentity` — AKS federated service-account token, injected by
 *     the azure-workload-identity admission webhook.
 *   - `managedIdentity` — the instance metadata identity endpoint (Azure VM
 *     / VMSS / App Service self-hosters).
 *   - `azureCli` — the developer's `az login` session (local dev only).
 *
 * Exported so tests exercise the real schema rather than an inline copy.
 */
export const azureBlobAuthModeSchema = z
  .enum(["sharedKey", "workloadIdentity", "managedIdentity", "azureCli"])
  .optional();

/**
 * `BASE_HOST` / `NEXTAUTH_URL` are the app's own address. Every state-changing
 * `/api/auth/*` call is matched against it (`server/routes/auth.ts` via
 * `better-auth/originGate.ts`, and BetterAuth's own `baseURL` + `trustedOrigins`
 * in `better-auth/index.ts`), so a value naming the wrong port turns every
 * sign-in into `403 INVALID_ORIGIN`.
 *
 * In development the port is not knowable ahead of time: `.env` is committed
 * with the default 5560 and a second checkout runs on whatever slot is free.
 * `scripts/start.sh` exports the aligned value, but the entry points load `.env`
 * with `override: true` afterwards (deliberately, so an explicitly pinned
 * `LW_GATEWAY_PUBLIC_URL` and friends beat the launcher's derived defaults), and
 * that puts 5560 back. Realigning here, after every `.env` file has loaded, is
 * what makes the alignment stick, and it leaves every other `.env`-pinned value
 * untouched.
 *
 * Only a plain `http://localhost:<port>` is treated as stale. Anything else is
 * someone's deliberate setup: `127.0.0.1`, a proxy in front of a preview
 * environment, a tunnel, or haven's `app.<slug>.langwatch.localhost`. Same rule
 * as the shell-side twin `dev/scripts/lib/sanitize-dev-env.sh`, which covers the
 * Docker launchers.
 *
 * Mutates the env object so direct `process.env.BASE_HOST` readers (the MCP
 * handler, the SSR API base, the scenario-events app) see the same address the
 * auth layer does.
 *
 * @param {Record<string, string | undefined>} processEnv
 * @returns {{ name: string, from: string, to: string }[]} the vars it realigned
 */
export function alignDevAuthUrlsToPort(processEnv) {
  if (processEnv.NODE_ENV !== "development") return [];

  const port = processEnv.LANGWATCH_APP_PORT ?? processEnv.PORT;
  if (!port) return [];

  const target = `http://localhost:${port}`;
  const realigned = [];

  for (const name of ["BASE_HOST", "NEXTAUTH_URL"]) {
    const current = processEnv[name];
    if (!current || current === target) continue;

    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" || parsed.hostname !== "localhost") continue;

    processEnv[name] = target;
    realigned.push({ name, from: current, to: target });
  }

  return realigned;
}

/**
 * Resolve the legacy application environment from an explicit source.
 * Importing this module is inert; executable boot code chooses the source and
 * invokes validation before it constructs the application graph.
 *
 * @param {Record<string, string | undefined>} source
 */
export function createEnvConfig(source) {
  alignDevAuthUrlsToPort(source);
  /** @param {import('zod').ZodTypeAny} schema */
  const optionalIfBuildTime = (schema) => (source.BUILD_TIME ? schema.optional() : schema);

  const environment = createEnv({
    // clientPrefix required by env-core to distinguish client/server vars
    // (env-nextjs set this to "NEXT_PUBLIC_" automatically)
    clientPrefix: "VITE_PUBLIC_",
    client: {},
    server: {
      DATABASE_URL: optionalIfBuildTime(z.string().url()),
      CLICKHOUSE_URL: z.string().url().optional(),
      CLICKHOUSE_OPS_URL: z.string().url().optional(),
      NODE_ENV: z.enum(["development", "test", "production"]),
      ENVIRONMENT: z
        .string()
        .optional()
        .transform((val) => {
          if (val) return val;
          if (source.NODE_ENV === "production") {
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
          (str) => source.VERCEL_URL ?? str,
          // VERCEL_URL doesn't include `https` so it cant be validated as a URL
          source.VERCEL ? z.string().min(1) : z.string().url(),
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
      SKIP_REDIS: z.boolean().optional(),
      REDIS_DB_INDEX: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z
          .string()
          .regex(/^(?:[0-9]|1[0-5])$/, "REDIS_DB_INDEX must be 0-15")
          .optional(),
      ),
      // Queue policy remains permissive at this boundary so composition can
      // preserve the established fallback behaviour for malformed values.
      GLOBAL_QUEUE_CONCURRENCY: z.string().optional(),
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: z.string().optional(),
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: z.string().optional(),
      LANGWATCH_FOLD_CACHE_TTL_SECONDS: z.string().optional(),
      GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
      // Opt out of Google Cloud DLP entirely. When set, the google_dlp PII
      // check is refused and the heavy @google-cloud/dlp SDK (generated protos
      // via google-gax/grpc — one of the largest single deps in the server
      // graph) is never imported. Off by default so DLP stays available for
      // deployments that have configured GOOGLE_APPLICATION_CREDENTIALS.
      LANGWATCH_DISABLE_GOOGLE_DLP: z.boolean().optional(),
      LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER: z.boolean().optional(),
      // Evaluation input offload thresholds are parsed into semantic AppConfig
      // at process boot; keep their raw values optional here for backwards
      // compatibility with existing deployments.
      LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES: z.string().optional(),
      LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES: z.string().optional(),
      AZURE_OPENAI_ENDPOINT: z.string().optional(),
      AZURE_OPENAI_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      SENDGRID_API_KEY: z.string().optional(),
      LANGWATCH_NLP_SERVICE: optionalIfBuildTime(z.string().url()),
      LANGWATCH_ENDPOINT: optionalIfBuildTime(z.string().url()),
      LANGWATCH_API_URL: z.string().url().optional(),
      LANGY_WORKER_CALLBACK_URL: z.string().url().optional(),
      LANGY_WORKER_GATEWAY_URL: z.string().url().optional(),
      LANGY_MIRROR_PROJECT_ID: z.string().min(1).optional(),
      LANGY_INTERNAL_SECRET: z.string().min(1).optional(),
      OPENCODE_AGENT_URL: langyWorkerAgentUrlSchema,
      LANGY_PROMPT_PROJECT_ID: z.string().min(1).optional(),
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
      // ADR-027: instance-level license, bootstraps + recovers SSO on
      // self-hosted deployments without requiring an in-DB org license.
      LANGWATCH_LICENSE_KEY: z.string().optional(),
      // ADR-117 §7: the one flag covering the identifier-first router (D03)
      // and the screens that render its decisions (D13). Three-valued and
      // shipped `off`, because the front door is the highest-risk flip in the
      // identity program: `shadow` computes the router's decision on every
      // live login and logs how it compares against the legacy outcome
      // WITHOUT changing anything, `enforce` is the flip, and `off` leaves the
      // legacy path byte-for-byte untouched. Rollback is this value.
      IDENTITY_ROUTER_V2: z.enum(["off", "shadow", "enforce"]).optional().default("off"),
      // D06: whether two-step verification exists at all. Reached SIGNED
      // OUT — a challenge stands between a password and a session — so it is
      // an env flag rather than a feature flag, which is read per project
      // and needs somebody already signed in to have a project.
      //
      // Off is byte-for-byte the old behaviour: the plugin is not registered,
      // so none of its routes are mounted and nothing about two-step
      // verification is reachable. Turning it back off leaves everybody who
      // set one up signed in and their enrollment rows intact — it stops
      // being ASKED for, and nothing is deleted.
      MFA_ENROLLMENT_OPEN: z.enum(["off", "on"]).optional().default("off"),
      // D07: whether passkeys exist. Same reasoning — registering a passkey
      // is reached signed out, on the sign-in screen. Off unmounts the
      // ceremony routes and hides the option; passkeys already registered
      // are left alone, so turning it on again finds them still there.
      PASSKEYS_ENABLED: z.enum(["off", "on"]).optional().default("off"),
      // ADR-117 §5: where the router's DOMAIN LOOKUP reads from. Three-valued
      // and shipped `off` for the same reason the router's own flag is: the
      // front door is the highest-risk flip in the identity program.
      // `off` composes today's `Organization.ssoDomain` strings and nothing
      // else. `shadow` still lets the strings decide, and runs the
      // `SsoConnection` projection lookup alongside so disagreements are
      // logged with both answers. `enforce` is the flip, and only at `enforce`
      // do the string writes stop. Rollback is this value.
      SSOCONN_ROUTING: z.enum(["off", "shadow", "enforce"]).optional().default("off"),
      // D08: whether a SCIM push writes membership through the grants
      // service. Two-valued, because there is no useful middle: `off` keeps
      // the previous write path — the hand-written OrganizationUser row with
      // its unconditional MEMBER role — and `on` routes every membership
      // consequence, including a deprovision and its empty proof, through
      // GrantsService. Connection scoping and the directory-sync history are
      // on either way; what this decides is who writes the membership.
      // Rollback is this value.
      SCIM_V2_GRANTS: z.enum(["off", "on"]).optional().default("off"),
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
      // Per-trigger daily ceiling on CONFIRMED persist dispatches — the dataset
      // rows and annotation-queue items an automation actually creates. Only
      // customer-attributable volume is counted: match records, unconfirmed
      // matches, debounce fan-out and retries are our amplification and are
      // never charged here.
      //
      // The tiers are set against what a human can consume rather than what a
      // machine can produce: annotation throughput is a few hundred items a day,
      // and 1,000 matches the existing per-project daily email cap. A single
      // contract can raise its own ceiling past the tier through
      // `PlanInfo.maxTriggerPersistDispatchesPerDay`.
      TRIGGER_PERSIST_DAILY_CAP_FREE: z.coerce.number().int().positive().default(100),
      TRIGGER_PERSIST_DAILY_CAP_PAID: z.coerce.number().int().positive().default(1000),
      TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE: z.coerce.number().int().positive().default(10000),
      DEMO_PROJECT_ID: z.string().optional(),
      DEMO_PROJECT_USER_ID: z.string().optional(),
      DEMO_PROJECT_SLUG: z.string().optional(),
      USE_AWS_SES: z.string().optional(),
      AWS_REGION: z.string().optional(),
      EMAIL_DEFAULT_FROM: z.string().optional(),
      // Email gateway selection. When unset, the provider is inferred from
      // whichever credentials are present, so existing deployments are
      // unaffected. See src/server/mailer/providers/index.ts.
      EMAIL_PROVIDER: z.string().optional(),
      AWS_SES_ENDPOINT: z.string().optional(),
      SMTP_URL: z.string().optional(),
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.string().optional(),
      SMTP_USER: z.string().optional(),
      SMTP_PASSWORD: z.string().optional(),
      SMTP_SECURE: z.string().optional(),
      RESEND_API_KEY: z.string().optional(),
      S3_KEY_SALT: z.string().optional(),
      // Not optional: the runtime mapping below derives it from two string
      // comparisons, which always yield a boolean. Declaring it optional made
      // every server-side reader carry a `| undefined` the value can never
      // have, and one of them — the Enterprise tRPC composition, which takes a
      // required `saasBilling: boolean` — could not be satisfied at all.
      IS_SAAS: z.boolean(),
      // Instance-wide bearer credential for the self-hosted organization
      // provisioning API (/api/organizations). Absent (the default) the
      // family answers 404; it is also absent-by-construction on SaaS, where
      // the route gate ignores the variable entirely. 32 characters minimum,
      // the same floor as the gateway secrets: one value provisions
      // organizations across the whole instance.
      LANGWATCH_INSTANCE_ADMIN_API_KEY: z.string().min(32).optional(),
      // Browser tracing (ADR-058). Off unless explicitly enabled: it adds
      // frontend telemetry volume, and the ingest route it exports to is
      // inert without OTEL_EXPORTER_OTLP_ENDPOINT anyway.
      RUM_ENABLED: z.boolean().optional(),
      // See `rumSampleRatioSchema` above.
      RUM_SAMPLE_RATIO: rumSampleRatioSchema,
      // Controls SSRF blocking for outbound HTTP calls (TS proxy + scenario
      // runner; mirrored on the Python NLP side via the same env name). When
      // true: private IPs, localhost, and hostnames resolving to private IPs
      // are blocked unless listed in ALLOWED_PROXY_HOSTS. When unset/false:
      // local destinations are allowed (cloud metadata is still always
      // blocked). Default: false.
      BLOCK_LOCAL_HTTP_CALLS: z.boolean().optional(),
      ALLOWED_PROXY_HOSTS: z.string().optional(),
      SHOW_OPS_IN_MAIN_SIDEBAR: z.string().optional(),
      DISABLE_TOKENIZATION: z.boolean().optional(),
      // Post-2026-05-11 loop-prevention kill-switch. Set to "1" to
      // bypass the subscriber depth check; emergency rollback only.
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
      // Explicit stored-objects write-destination toggle. "s3" is the
      // implicit default (existing BYOC -> S3_BUCKET_NAME -> local-FS
      // precedence); "azure" opts a deployment into the Azure Blob backend.
      // See storedObjectsBackendSchema above and
      // resolveProjectStorageDestination for the full precedence rules.
      STORED_OBJECTS_BACKEND: storedObjectsBackendSchema,
      // Azure Blob Storage — optional alternative to S3 for stored-objects,
      // selected ONLY by STORED_OBJECTS_BACKEND=azure above (never inferred
      // from these vars being present). Set all four together when using
      // the azure backend; AZURE_BLOB_ENDPOINT only needs to be set for
      // emulator or sovereign-cloud deployments (e.g. Azurite, Azure Gov).
      AZURE_BLOB_ACCOUNT_NAME: z.string().optional(),
      AZURE_BLOB_ACCOUNT_KEY: z.string().optional(),
      AZURE_BLOB_ENDPOINT: z.string().optional(),
      AZURE_BLOB_CONTAINER: z.string().optional(),
      // See azureBlobAuthModeSchema above. Validated only when
      // STORED_OBJECTS_BACKEND=azure — resolveAzureCredentials rejects it
      // otherwise as dead config.
      AZURE_BLOB_AUTH_MODE: azureBlobAuthModeSchema,
      // Sovereign-cloud (e.g. Azure Government, Azure China) identity
      // authority host for token exchange. Required alongside a
      // token-based AZURE_BLOB_AUTH_MODE whenever AZURE_BLOB_ENDPOINT does
      // not address the public *.blob.core.windows.net cloud — see
      // resolveAzureCredentials in azure-credentials.ts.
      AZURE_BLOB_AUTHORITY_HOST: z.string().optional(),
      // Sovereign-cloud storage resource audience used to scope the token
      // request (`{audience}/.default`). Defaults to the public-cloud
      // "https://storage.azure.com" audience when unset.
      AZURE_BLOB_TOKEN_AUDIENCE: z.string().optional(),
      // The ADR-022 trace spool is bounded by a lifecycle rule the operator
      // provisions on the container, NOT by anything the application does: it
      // deletes eagerly after the event_log INSERT, and a crash between those
      // two steps is what the rule reaps. That rule lives on Azure's
      // MANAGEMENT plane (Microsoft.Storage/.../managementPolicies), and this
      // deployment holds only a data-plane key, so the app cannot read it back
      // to check. This flag is the operator asserting it exists. Default false
      // means an Azure install that enables the spool without thinking about
      // retention degrades to inline payloads rather than accumulating
      // customer data nothing will ever reap.
      AZURE_BLOB_SPOOL_RETENTION_CONFIRMED: z.boolean().optional(),
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

      // The GitHub App behind the organization's GitHub connection: Langy
      // opens bot-authored pull requests through it, and pull-request linkage
      // reads through it. Separate from the GITHUB_CLIENT_* identity-login app
      // above. The names still say LANGY because they are set on every
      // deployment; renaming them is an infra change of its own. All optional:
      // when the private key is unset the integration is silently off, the
      // settings card explains it is unavailable, and no installation token can
      // be minted. Boot composition reads these once and injects semantic
      // configuration into the GitHub feature.
      //   GITHUB_LANGY_APP_ID        — numeric App ID (JWT `iss`).
      //   GITHUB_LANGY_PRIVATE_KEY   — the App's RSA private key PEM (signs the
      //                                app JWT used to mint installation tokens).
      //   GITHUB_LANGY_WEBHOOK_SECRET— verifies X-Hub-Signature-256 on inbound
      //                                installation webhooks.
      //   GITHUB_LANGY_APP_SLUG      — the App's slug, for the install deep-link
      //                                github.com/apps/<slug>/installations/new.
      //
      // GITHUB_LANGY_HOST is the GitHub host this instance connects to. Unset
      // means github.com. Set it to a GitHub Enterprise Server hostname to bind
      // the instance to that server.
      GITHUB_LANGY_APP_ID: z.string().optional(),
      GITHUB_LANGY_PRIVATE_KEY: z.string().optional(),
      GITHUB_LANGY_WEBHOOK_SECRET: z.string().optional(),
      GITHUB_LANGY_APP_SLUG: z.string().optional(),
      GITHUB_LANGY_HOST: z.string().optional(),

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

      // OneLogin
      ONELOGIN_CLIENT_ID: z.string().optional(),
      ONELOGIN_CLIENT_SECRET: z.string().optional(),
      ONELOGIN_ISSUER: z.string().optional(),

      // Any other OpenID Connect provider. Its endpoints are discovered from
      // the issuer, so there is nothing to configure beyond these three.
      OIDC_CLIENT_ID: z.string().optional(),
      OIDC_CLIENT_SECRET: z.string().optional(),
      OIDC_ISSUER: z.string().optional(),

      POSTHOG_KEY: z.string().optional(),
      POSTHOG_HOST: z.string().optional(),
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
      // Agent issue-report alerts (bot token of the LangWatch Agents Slack
      // app; alerts are skipped entirely when unset)
      SLACK_BUG_REPORTS_BOT_TOKEN: z.string().optional(),
      SLACK_BUG_REPORTS_CHANNEL: z.string().optional(),

      // SCIM
      AUTH0_SCIM_WEBHOOK_SECRET: z.string().optional(),
    },

    // No client-side env vars — use `publicEnv.ts` instead.
    // Runtime env values — must be destructured explicitly.
    runtimeEnv: {
      DATABASE_URL: source.DATABASE_URL,
      CLICKHOUSE_URL: source.CLICKHOUSE_URL,
      CLICKHOUSE_OPS_URL: source.CLICKHOUSE_OPS_URL,
      NODE_ENV: source.NODE_ENV,
      ENVIRONMENT: source.ENVIRONMENT,
      BASE_HOST: source.BASE_HOST,
      NEXTAUTH_PROVIDER: source.NEXTAUTH_PROVIDER ?? "email",
      NEXTAUTH_SECRET: source.NEXTAUTH_SECRET,
      NEXTAUTH_URL: source.NEXTAUTH_URL,
      LW_GATEWAY_INTERNAL_SECRET: source.LW_GATEWAY_INTERNAL_SECRET,
      LW_GATEWAY_JWT_SECRET: source.LW_GATEWAY_JWT_SECRET,
      LW_GATEWAY_BASE_URL: source.LW_GATEWAY_BASE_URL,
      LW_GATEWAY_PUBLIC_URL: source.LW_GATEWAY_PUBLIC_URL,
      LW_GATEWAY_INTERNAL_URL: source.LW_GATEWAY_INTERNAL_URL,
      LW_VIRTUAL_KEY_PEPPER: source.LW_VIRTUAL_KEY_PEPPER,
      AUTH0_CLIENT_ID: source.AUTH0_CLIENT_ID,
      AUTH0_CLIENT_SECRET: source.AUTH0_CLIENT_SECRET,
      AUTH0_ISSUER: source.AUTH0_ISSUER,
      AUTH0_MGMT_CLIENT_ID: source.AUTH0_MGMT_CLIENT_ID,
      AUTH0_MGMT_CLIENT_SECRET: source.AUTH0_MGMT_CLIENT_SECRET,
      API_TOKEN_JWT_SECRET: source.API_TOKEN_JWT_SECRET,
      REDIS_URL: source.REDIS_URL,
      REDIS_CLUSTER_ENDPOINTS: source.REDIS_CLUSTER_ENDPOINTS,
      SKIP_REDIS: source.SKIP_REDIS === "1" || source.SKIP_REDIS?.toLowerCase() === "true",
      REDIS_DB_INDEX: source.REDIS_DB_INDEX,
      GLOBAL_QUEUE_CONCURRENCY: source.GLOBAL_QUEUE_CONCURRENCY,
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: source.GROUP_QUEUE_ZSTD_WRITES_ENABLED,
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: source.GROUP_QUEUE_MSGPACK_WRITES_ENABLED,
      LANGWATCH_FOLD_CACHE_TTL_SECONDS: source.LANGWATCH_FOLD_CACHE_TTL_SECONDS,
      GOOGLE_APPLICATION_CREDENTIALS: source.GOOGLE_APPLICATION_CREDENTIALS,
      LANGWATCH_DISABLE_GOOGLE_DLP: source.LANGWATCH_DISABLE_GOOGLE_DLP?.toLowerCase() === "true",
      LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER:
        source.LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER?.toLowerCase() === "true",
      LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES: source.LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES,
      LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES: source.LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES,
      AZURE_OPENAI_ENDPOINT: source.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_KEY: source.AZURE_OPENAI_KEY,
      OPENAI_API_KEY: source.OPENAI_API_KEY,
      SENDGRID_API_KEY: source.SENDGRID_API_KEY,
      LANGWATCH_NLP_SERVICE: source.LANGWATCH_NLP_SERVICE,
      LANGWATCH_ENDPOINT: source.LANGWATCH_ENDPOINT,
      LANGWATCH_API_URL: source.LANGWATCH_API_URL,
      LANGY_WORKER_CALLBACK_URL: source.LANGY_WORKER_CALLBACK_URL,
      LANGY_WORKER_GATEWAY_URL: source.LANGY_WORKER_GATEWAY_URL,
      LANGY_MIRROR_PROJECT_ID: source.LANGY_MIRROR_PROJECT_ID,
      LANGY_INTERNAL_SECRET: source.LANGY_INTERNAL_SECRET,
      OPENCODE_AGENT_URL: source.OPENCODE_AGENT_URL,
      LANGY_PROMPT_PROJECT_ID: source.LANGY_PROMPT_PROJECT_ID,
      LANGEVALS_ENDPOINT: source.LANGEVALS_ENDPOINT,
      LANGEVALS_STAGING_THRESHOLD_BYTES: source.LANGEVALS_STAGING_THRESHOLD_BYTES,
      LANGEVALS_STAGING_TTL_SECONDS: source.LANGEVALS_STAGING_TTL_SECONDS,
      EVAL_MAX_PAYLOAD_BYTES: source.EVAL_MAX_PAYLOAD_BYTES,
      TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES: source.TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES,
      LANGWATCH_LICENSE_KEY: source.LANGWATCH_LICENSE_KEY,
      TRIGGER_EMAIL_HOURLY_CAP: source.TRIGGER_EMAIL_HOURLY_CAP,
      TRIGGER_EMAIL_TENANT_DAILY_CAP: source.TRIGGER_EMAIL_TENANT_DAILY_CAP,
      TRIGGER_PERSIST_DAILY_CAP_FREE: source.TRIGGER_PERSIST_DAILY_CAP_FREE,
      TRIGGER_PERSIST_DAILY_CAP_PAID: source.TRIGGER_PERSIST_DAILY_CAP_PAID,
      TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE: source.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE,
      DEMO_PROJECT_ID: source.DEMO_PROJECT_ID,
      DEMO_PROJECT_USER_ID: source.DEMO_PROJECT_USER_ID,
      DEMO_PROJECT_SLUG: source.DEMO_PROJECT_SLUG,
      USE_AWS_SES: source.USE_AWS_SES,
      AWS_REGION: source.AWS_REGION,
      EMAIL_DEFAULT_FROM: source.EMAIL_DEFAULT_FROM,
      EMAIL_PROVIDER: source.EMAIL_PROVIDER,
      AWS_SES_ENDPOINT: source.AWS_SES_ENDPOINT,
      SMTP_URL: source.SMTP_URL,
      SMTP_HOST: source.SMTP_HOST,
      SMTP_PORT: source.SMTP_PORT,
      SMTP_USER: source.SMTP_USER,
      SMTP_PASSWORD: source.SMTP_PASSWORD,
      SMTP_SECURE: source.SMTP_SECURE,
      RESEND_API_KEY: source.RESEND_API_KEY,
      S3_KEY_SALT: source.S3_KEY_SALT,
      IS_SAAS: source.IS_SAAS === "1" || source.IS_SAAS?.toLowerCase() === "true",
      // Blank means unset, so a templated .env line with no value cannot take
      // the whole deployment down over an optional credential.
      LANGWATCH_INSTANCE_ADMIN_API_KEY: source.LANGWATCH_INSTANCE_ADMIN_API_KEY || undefined,
      RUM_ENABLED: source.RUM_ENABLED === "1" || source.RUM_ENABLED?.toLowerCase() === "true",
      RUM_SAMPLE_RATIO: source.RUM_SAMPLE_RATIO,
      BLOCK_LOCAL_HTTP_CALLS:
        source.BLOCK_LOCAL_HTTP_CALLS === "1" ||
        source.BLOCK_LOCAL_HTTP_CALLS?.toLowerCase() === "true",
      ALLOWED_PROXY_HOSTS: source.ALLOWED_PROXY_HOSTS,
      SHOW_OPS_IN_MAIN_SIDEBAR: source.SHOW_OPS_IN_MAIN_SIDEBAR,
      DISABLE_TOKENIZATION:
        source.DISABLE_TOKENIZATION === "1" ||
        source.DISABLE_TOKENIZATION?.toLowerCase() === "true",
      LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: source.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD,
      LANGWATCH_DISPATCH_TENANT_CAP: source.LANGWATCH_DISPATCH_TENANT_CAP,
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: source.LANGWATCH_DISPATCH_GLOBAL_BUDGET,
      USE_S3_STORAGE:
        source.USE_S3_STORAGE === "1" || source.USE_S3_STORAGE?.toLowerCase() === "true",
      S3_ENDPOINT: source.S3_ENDPOINT,
      S3_ACCESS_KEY_ID: source.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: source.S3_SECRET_ACCESS_KEY,
      S3_SESSION_TOKEN: source.S3_SESSION_TOKEN,
      S3_REGION: source.S3_REGION,
      S3_BUCKET_NAME: source.S3_BUCKET_NAME,
      LANGWATCH_LOCAL_STORAGE_PATH: source.LANGWATCH_LOCAL_STORAGE_PATH,
      STORED_OBJECTS_BACKEND: source.STORED_OBJECTS_BACKEND,
      AZURE_BLOB_ACCOUNT_NAME: source.AZURE_BLOB_ACCOUNT_NAME,
      AZURE_BLOB_ACCOUNT_KEY: source.AZURE_BLOB_ACCOUNT_KEY,
      AZURE_BLOB_ENDPOINT: source.AZURE_BLOB_ENDPOINT,
      AZURE_BLOB_CONTAINER: source.AZURE_BLOB_CONTAINER,
      AZURE_BLOB_AUTH_MODE: source.AZURE_BLOB_AUTH_MODE,
      AZURE_BLOB_AUTHORITY_HOST: source.AZURE_BLOB_AUTHORITY_HOST,
      AZURE_BLOB_TOKEN_AUDIENCE: source.AZURE_BLOB_TOKEN_AUDIENCE,
      AZURE_BLOB_SPOOL_RETENTION_CONFIRMED:
        source.AZURE_BLOB_SPOOL_RETENTION_CONFIRMED === "1" ||
        source.AZURE_BLOB_SPOOL_RETENTION_CONFIRMED?.toLowerCase() === "true",
      DATASET_STORAGE_LOCAL:
        source.DATASET_STORAGE_LOCAL === "1" ||
        source.DATASET_STORAGE_LOCAL?.toLowerCase() === "true",
      CREDENTIALS_SECRET: source.CREDENTIALS_SECRET,
      AZURE_AD_CLIENT_ID: source.AZURE_AD_CLIENT_ID,
      AZURE_AD_CLIENT_SECRET: source.AZURE_AD_CLIENT_SECRET,
      AZURE_AD_TENANT_ID: source.AZURE_AD_TENANT_ID,
      COGNITO_CLIENT_ID: source.COGNITO_CLIENT_ID,
      COGNITO_ISSUER: source.COGNITO_ISSUER,
      COGNITO_CLIENT_SECRET: source.COGNITO_CLIENT_SECRET,
      POSTHOG_KEY: source.POSTHOG_KEY,
      POSTHOG_HOST: source.POSTHOG_HOST,
      DISABLE_USAGE_STATS:
        source.DISABLE_USAGE_STATS === "1" || source.DISABLE_USAGE_STATS?.toLowerCase() === "true",
      LANGWATCH_NLP_LAMBDA_CONFIG: source.LANGWATCH_NLP_LAMBDA_CONFIG,
      GITHUB_CLIENT_ID: source.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: source.GITHUB_CLIENT_SECRET,
      GITHUB_LANGY_APP_ID: source.GITHUB_LANGY_APP_ID,
      GITHUB_LANGY_PRIVATE_KEY: source.GITHUB_LANGY_PRIVATE_KEY,
      GITHUB_LANGY_WEBHOOK_SECRET: source.GITHUB_LANGY_WEBHOOK_SECRET,
      GITHUB_LANGY_APP_SLUG: source.GITHUB_LANGY_APP_SLUG,
      GITHUB_LANGY_HOST: source.GITHUB_LANGY_HOST,
      GITLAB_CLIENT_ID: source.GITLAB_CLIENT_ID,
      GITLAB_CLIENT_SECRET: source.GITLAB_CLIENT_SECRET,
      GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
      OKTA_CLIENT_ID: source.OKTA_CLIENT_ID,
      OKTA_CLIENT_SECRET: source.OKTA_CLIENT_SECRET,
      OKTA_ISSUER: source.OKTA_ISSUER,
      ONELOGIN_CLIENT_ID: source.ONELOGIN_CLIENT_ID,
      ONELOGIN_CLIENT_SECRET: source.ONELOGIN_CLIENT_SECRET,
      ONELOGIN_ISSUER: source.ONELOGIN_ISSUER,
      OIDC_CLIENT_ID: source.OIDC_CLIENT_ID,
      OIDC_CLIENT_SECRET: source.OIDC_CLIENT_SECRET,
      OIDC_ISSUER: source.OIDC_ISSUER,
      OTEL_EXPORTER_OTLP_ENDPOINT: source.OTEL_EXPORTER_OTLP_ENDPOINT,
      CLICKHOUSE_CLUSTER: source.CLICKHOUSE_CLUSTER,
      LANGWATCH_LICENSE_PUBLIC_KEY: source.LANGWATCH_LICENSE_PUBLIC_KEY,
      LANGWATCH_LICENSE_PRIVATE_KEY: source.LANGWATCH_LICENSE_PRIVATE_KEY,
      STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
      STRIPE_LICENSE_PAYMENT_LINK_ID: source.STRIPE_LICENSE_PAYMENT_LINK_ID,
      STRIPE_LICENSE_PAYMENT_LINK_URL: source.STRIPE_LICENSE_PAYMENT_LINK_URL,
      ADMIN_EMAILS: source.ADMIN_EMAILS,
      HUBSPOT_PORTAL_ID: source.HUBSPOT_PORTAL_ID,
      HUBSPOT_REACHED_LIMIT_FORM_ID: source.HUBSPOT_REACHED_LIMIT_FORM_ID,
      HUBSPOT_FORM_ID: source.HUBSPOT_FORM_ID,
      CUSTOMER_IO_API_KEY: source.CUSTOMER_IO_API_KEY,
      CUSTOMER_IO_REGION: source.CUSTOMER_IO_REGION,
      SLACK_PLAN_LIMIT_CHANNEL: source.SLACK_PLAN_LIMIT_CHANNEL,
      SLACK_BUG_REPORTS_BOT_TOKEN: source.SLACK_BUG_REPORTS_BOT_TOKEN,
      SLACK_BUG_REPORTS_CHANNEL: source.SLACK_BUG_REPORTS_CHANNEL,
      SLACK_CHANNEL_SIGNUPS: source.SLACK_CHANNEL_SIGNUPS,
      SLACK_CHANNEL_SUBSCRIPTIONS: source.SLACK_CHANNEL_SUBSCRIPTIONS,
      AUTH0_SCIM_WEBHOOK_SECRET: source.AUTH0_SCIM_WEBHOOK_SECRET,
    },
    /**
     * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
     * This is especially useful for Docker builds.
     */
    skipValidation: !!source.SKIP_ENV_VALIDATION,
  });

  // Server-side only: the validated env proxy from `createEnv()` throws
  // "Attempted to access a server-side environment variable on the client"
  // if we touch any of these keys from the browser bundle. Read from
  // source directly and skip the guard entirely when we're being
  // imported into a client bundle (typeof window !== "undefined").
  if (typeof window === "undefined" && !source.SKIP_ENV_VALIDATION && !source.BUILD_TIME) {
    if (
      (source.IS_SAAS === "1" || source.IS_SAAS?.toLowerCase() === "true") &&
      !(
        source.BLOCK_LOCAL_HTTP_CALLS === "1" ||
        source.BLOCK_LOCAL_HTTP_CALLS?.toLowerCase() === "true"
      )
    ) {
      throw new Error(
        "IS_SAAS=true requires BLOCK_LOCAL_HTTP_CALLS=true to keep SSRF protections enabled",
      );
    }
    assertGatewaySecretsAllOrNone(source);
  }

  return environment;
}

/**
 * Cross-field guard on AI Gateway secrets. Each secret is individually
 * `.optional()` so deployments that don't use the gateway pass clean —
 * but a deployment that sets two of three is a latent bug that only
 * surfaces minutes after startup when the first VK request hits
 * /api/internal/gateway/* and returns 503 auth_upstream_unavailable.
 *
 * Lives in the shared resolver so each executable gets the same assertion
 * when it explicitly initializes its selected source.
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
      "  Either set ALL three secrets (see .env.example) or UNSET",
      "  them all. Partial config leaves /api/internal/gateway/* returning",
      "  503 auth_upstream_unavailable at request time.",
      "  Generate each value with: openssl rand -hex 32",
      "========================================================================",
      "",
    ].join("\n");
    // eslint-disable-next-line no-console
    console.error(banner);
    throw new Error(`AI Gateway secrets partial config (missing: ${missing.join(", ")})`);
  }
}
