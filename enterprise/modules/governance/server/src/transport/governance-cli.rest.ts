// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The governance plane as the CLI reaches it: fourteen routes under
 * `/api/auth/cli` that authenticate with a device-session bearer and dispatch
 * into Enterprise governance. @see specs/ai-gateway/governance/
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  governanceCliIngestionKeyRequestSchema,
  governanceCliKeyLookupParamsSchema,
  governanceCliProjectKeyRequestSchema,
  governanceCliSourceEventsQuerySchema,
  governanceCliSourceParamsSchema,
  governanceCliSourcesQuerySchema,
  governanceCliVirtualKeyRequestSchema,
  type GovernanceApi,
  type GovernanceCliIngestionKey,
  type GovernanceCliIngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import { moduleApi } from "@langwatch/kernel";

import type {
  GovernanceCliAccessApi,
  GovernanceCliCaller,
  GovernanceCliEnterpriseFeature,
} from "../services/governance-cli-access.service.ts";
import type { GovernanceCliActivityApi } from "../services/governance-cli-activity.service.ts";
import type {
  GovernanceCliCredentialApi,
  GovernanceCliIngestionKeyOutcome,
} from "../services/governance-cli-credentials.service.ts";

/**
 * What the CLI governance plane calls. Declared here rather than in the
 * contract because the services behind it read this feature server's own
 * repositories, which a contract package may not name.
 */
export type GovernanceCliRestApi = Readonly<{
  /** The bearer, the plan and the RBAC permission, in that order. */
  cliAccess: () => GovernanceCliAccessApi;
  /** Everything this family hands back or mints. */
  cliCredentials: () => GovernanceCliCredentialApi;
  /** The Activity Monitor reads, each with its ownership proof. */
  cliActivity: () => GovernanceCliActivityApi;
  /** The SAME governance service the console's tRPC procedures read. */
  governance: () => GovernanceApi;
}>;

export const GovernanceCliRestApi = moduleApi<GovernanceCliRestApi>()("governance");

const JSON_MEDIA_TYPE = "application/json";

/**
 * Every answer here is the CLI's own contract, written by the handler: the
 * `{ error, error_description }` bodies released `langwatch` builds already
 * parse, and the bearer resolved in-handler off the `Authorization` header.
 */
const CLI_DOOR = publicRoute({
  reason:
    "the CLI governance plane authenticates its caller inside its own handlers from a device-session bearer, gates on the plan and the organization permission there, and answers its own 401, 402, 403 and RFC 8628-shaped refusals",
});

/** A JSON body this family writes itself, exactly as its clients read it. */
function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_MEDIA_TYPE },
  });
}

/** One refusal, in the two-field shape every released CLI parses. */
function refuse(error: string, description: string, status: number): Response {
  return answer({ error, error_description: description }, status);
}

/** The posted document, or an empty one where the body was not JSON. */
function posted(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

const unauthorized = (): Response =>
  refuse("unauthorized", "Bearer access token is missing, malformed, or expired", 401);

const membershipEnded = (): Response =>
  refuse(
    "forbidden",
    "Your access to this organization has ended. Run `langwatch login` to sign in again.",
    403,
  );

/** The `Authorization` header a handler resolves its own caller from. */
function findBearer(request: Request): string | null {
  return request.headers.get("Authorization");
}

/**
 * The bearer, then — where a route names them — the plan and the permission.
 * Ordered so a bearer only proves organization membership: without the
 * permission check any member could read every source and every event.
 */
async function admitted(input: {
  app: GovernanceCliRestApi;
  request: Request;
  feature?: GovernanceCliEnterpriseFeature;
  permission?: AuthzPermission;
}): Promise<{ caller: GovernanceCliCaller } | { refusal: Response }> {
  const access = input.app.cliAccess();
  const caller = await access.findCaller(findBearer(input.request));

  if (!caller) return { refusal: unauthorized() };

  if (input.feature) {
    const plan = await access.planDecision({
      organizationId: caller.organization_id,
      feature: input.feature,
    });

    // 402 with the upgrade URL inline (RFC 7231 §6.5.2), so the CLI renders an
    // actionable upsell without a second call.
    if (!plan.entitled) {
      return {
        refusal: answer(
          {
            error: "payment_required",
            error_description: plan.errorMessage,
            upgrade_url: plan.upgradeUrl,
          },
          402,
        ),
      };
    }
  }

  if (input.permission) {
    const permitted = await access.organizationPermission({
      caller,
      permission: input.permission,
    });

    if (!permitted) {
      return {
        refusal: refuse(
          "forbidden",
          `Missing required permission '${input.permission}' on this organization`,
          403,
        ),
      };
    }
  }

  return { caller };
}

/**
 * The bearer plus the tenancy boundary every route that mints or hands back a
 * credential adds: a token minted before an offboarding is still
 * cryptographically fine, and these keys are the ones the owner ceiling never
 * reaches.
 */
async function admittedMember(input: {
  app: GovernanceCliRestApi;
  request: Request;
}): Promise<{ caller: GovernanceCliCaller } | { refusal: Response }> {
  const gate = await admitted(input);

  if ("refusal" in gate) return gate;

  const membership = await input.app
    .cliAccess()
    .activeMembership({ caller: gate.caller, authHeader: findBearer(input.request) });

  return membership.active ? gate : { refusal: membershipEnded() };
}

/** One ingestion template on the snake_case wire the CLI expects. */
function toTemplate(row: {
  id: string;
  organizationId: string | null;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
}): GovernanceCliIngestionTemplate {
  return {
    id: row.id,
    organization_id: row.organizationId,
    slug: row.slug,
    source_type: row.sourceType,
    display_name: row.displayName,
    description: row.description,
    icon_asset: row.iconAsset,
    credential_schema: row.credentialSchema,
    ottl_rules: row.ottlRules,
    platform_published: row.platformPublished,
    enabled: row.enabled,
  };
}

/** One live personal ingestion key, as the CLI's liveness pre-flight reads it. */
function toIngestionKey(row: {
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
}): GovernanceCliIngestionKey {
  return {
    source_type: row.sourceType,
    lookup_id: row.lookupId,
    ingestion_template_id: row.ingestionTemplateId,
  };
}

/** The mint's refusals, each in the words the CLI has always shown. */
function renderIngestionKey(outcome: GovernanceCliIngestionKeyOutcome): Response {
  switch (outcome.outcome) {
    case "minted":
      return answer(
        {
          token: outcome.token,
          prefix: outcome.prefix,
          endpoint: outcome.endpoint,
          ...(outcome.project ? { project: outcome.project } : {}),
        },
        201,
      );
    case "direct-otel-not-allowed":
      return refuse(
        "direct_otel_not_allowed",
        `Your organization does not allow ${outcome.toolSlug} to send telemetry directly. Run \`langwatch ${outcome.toolSlug}\`, which routes through the gateway.`,
        403,
      );
    case "project-not-found":
      return refuse(
        "project_not_found",
        `No project "${outcome.projectRef}" in your organization`,
        404,
      );
    case "personal-project-not-allowed":
      return refuse(
        "personal_project_not_allowed",
        "Another user's personal project can't receive your ingestion key. Pick a shared team project, or your own personal workspace.",
        400,
      );
    case "forbidden":
      return refuse(
        "forbidden",
        "You need permission to write traces into this project to mint an ingestion key for it.",
        403,
      );
    case "source-type-not-personal":
      return refuse(
        "invalid_request",
        `No personal ingestion key is minted for source type ${outcome.sourceType}. Personal keys are minted for the tools the LangWatch CLI wraps.`,
        400,
      );
    case "personal-workspace-missing":
      return refuse(
        "precondition_failed",
        "Sign in to a personal workspace before issuing an ingestion key.",
        412,
      );
    case "failed":
      return refuse("server_error", "Could not mint an ingestion key", 500);
  }
}

/**
 * `/api/auth/cli`, at exactly the paths released `langwatch` builds call.
 * Literal because the flow's contract is its generation, not a date; the
 * `/api/v1` twin every `/api` family answers under is kept. ORDERING: mount
 * this family BEFORE the `/api/auth/*` catch-all.
 */
export const governanceCliRest = defineRestRouter(GovernanceCliRestApi)
  .withNamespace("governance-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  /**
   * The pre-flight `langwatch claude` / `codex` / `cursor` / `gemini` call
   * before exec'ing the wrapped tool, so the wrapper can render the
   * budget-exceeded box without making any real model calls.
   */
  .get("/api/auth/cli/budget/status", "readCliBudgetStatus")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const status = await app.cliCredentials().budgetStatus(gate.caller);

    if (status.outcome === "clear") return answer({ ok: true });

    return answer(
      {
        error: {
          type: "budget_exceeded",
          scope: status.scope,
          limit_usd: status.limitUsd,
          spent_usd: status.spentUsd,
          period: status.period,
          request_increase_url: status.requestIncreaseUrl,
          admin_email: status.adminEmail,
        },
      },
      402,
    );
  })

  /**
   * The login-completion ceremony. The wire shape matches the tRPC
   * `user.cliBootstrap` procedure byte for byte — both read one service.
   */
  .get("/api/auth/cli/bootstrap", "readCliBootstrap")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    return answer(
      await app.governance().cliBootstrapResolve({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  })

  /**
   * Every budget that binds the caller's own keys, for the `langwatch login`
   * epilogue. Matches the tRPC `user.budgetOverview` procedure byte for byte.
   */
  .get("/api/auth/cli/budget-overview", "readCliBudgetOverview")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    return answer(
      await app.governance().personalBudgetOverviewForUser({
        userId: gate.caller.user_id,
        organizationId: gate.caller.organization_id,
      }),
    );
  })

  /**
   * Lazy personal-key exchange for device sessions minted before the exchange
   * shipped the personal project. The tenancy boundary runs BEFORE the ensure,
   * which would otherwise recreate a workspace in a former tenant.
   */
  .get("/api/auth/cli/personal-project", "readCliPersonalProject")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admittedMember({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const resolved = await app.cliCredentials().resolvePersonalProject(gate.caller);

    if (resolved.outcome === "failed") {
      return refuse("server_error", "Could not resolve your personal project", 500);
    }

    return answer({
      project: {
        id: resolved.project.id,
        slug: resolved.project.slug,
        name: resolved.project.name,
        api_key: resolved.project.apiKey,
      },
    });
  })

  /**
   * The only way the CLI obtains a personal virtual key: asked the first time
   * a tool resolves to gateway mode, so a login that never routes a model call
   * leaves no key behind.
   */
  .post("/api/auth/cli/virtual-key", "issueCliVirtualKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    const gate = await admittedMember({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const parsed = governanceCliVirtualKeyRequestSchema.safeParse(posted(raw));

    if (!parsed.success) {
      return refuse("invalid_request", "device_label must be a string", 400);
    }

    const issued = await app.cliCredentials().issuePersonalVirtualKey({
      caller: gate.caller,
      deviceLabel: parsed.data.device_label,
    });

    if (issued.outcome === "no-eligible-providers") {
      return refuse(
        "no_eligible_providers",
        "Your organization has no AI providers configured for the gateway. Ask an admin to add one at Settings → Model Providers.",
        409,
      );
    }

    if (issued.outcome === "failed") {
      return refuse("server_error", "Could not issue a personal virtual key", 500);
    }

    return answer({ id: issued.id, secret: issued.secret, prefix: issued.prefix }, 201);
  })

  /**
   * `langwatch login --project <slug>` in a headless context. Nothing new is
   * minted — the project's existing key is returned — and the caller's OWN
   * personal project is allowed, exactly like an explicit pick on the
   * authorize page; anyone else's is refused.
   */
  .post("/api/auth/cli/project-key", "readCliProjectKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    const gate = await admittedMember({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const parsed = governanceCliProjectKeyRequestSchema.safeParse(posted(raw));

    if (!parsed.success) return refuse("invalid_request", "slug is required", 400);

    const handout = await app
      .cliCredentials()
      .handOutProjectKey({ caller: gate.caller, slug: parsed.data.slug });

    switch (handout.outcome) {
      case "project-not-found":
        return refuse(
          "not_found",
          `No project with slug "${handout.slug}" in your organization`,
          404,
        );
      case "personal-project-not-allowed":
        return refuse(
          "personal_project_not_allowed",
          "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
          400,
        );
      case "forbidden":
        return refuse(
          "forbidden",
          "You need write access to this project to retrieve its API key.",
          403,
        );
      case "granted":
        return answer({ api_key: handout.apiKey, project: handout.project });
    }
  })

  .get("/api/auth/cli/governance/ingest/sources", "listCliIngestionSources")
  .withQuery(governanceCliSourcesQuerySchema)
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const gate = await admitted({
      app,
      request,
      feature: "ingestionSources",
      permission: "ingestionSources:view",
    });

    if ("refusal" in gate) return gate.refusal;

    const sources = await app.cliActivity().sources({
      organizationId: gate.caller.organization_id,
      includeArchived: input.include_archived,
    });

    return answer({
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        description: source.description,
        status: source.status,
        lastEventAt: source.lastEventAt?.toISOString() ?? null,
        createdAt: source.createdAt.toISOString(),
        archivedAt: source.archivedAt?.toISOString() ?? null,
      })),
    });
  })

  .get("/api/auth/cli/governance/ingest/sources/:id/events", "listCliIngestionSourceEvents")
  .withParams(governanceCliSourceParamsSchema)
  .withQuery(governanceCliSourceEventsQuerySchema)
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const gate = await admitted({
      app,
      request,
      feature: "activityMonitor",
      permission: "activityMonitor:view",
    });

    if ("refusal" in gate) return gate.refusal;

    const events = await app.cliActivity().eventsForSource({
      organizationId: gate.caller.organization_id,
      sourceId: input.id,
      limit: input.limit,
      beforeIso: input.before_iso,
    });

    return answer({ events });
  })

  .get("/api/auth/cli/governance/ingest/sources/:id/health", "readCliIngestionSourceHealth")
  .withParams(governanceCliSourceParamsSchema)
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const gate = await admitted({
      app,
      request,
      feature: "ingestionSources",
      permission: "activityMonitor:view",
    });

    if ("refusal" in gate) return gate.refusal;

    return answer(
      await app.cliActivity().healthForSource({
        organizationId: gate.caller.organization_id,
        sourceId: input.id,
      }),
    );
  })

  .get("/api/auth/cli/governance/status", "readCliGovernanceStatus")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request, feature: "ingestionSources" });

    if ("refusal" in gate) return gate.refusal;

    return answer({
      setup: await app.governance().resolveSetupState(gate.caller.organization_id),
    });
  })

  /**
   * The project-scoped `/api/governance/ingestion-templates` rejects a device
   * token with 401; this door resolves the organization from the validated
   * bearer and delegates to the same service. The snake_case envelope is what
   * the CLI expects, distinct from that door's `{ data: [...] }`.
   */
  .get("/api/auth/cli/governance/ingestion-templates", "listCliIngestionTemplates")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const rows = await app
      .governance()
      .templateListForUser({ organizationId: gate.caller.organization_id });

    return answer({ ingestion_templates: rows.map(toTemplate) });
  })

  /**
   * Mints a write-only `ik-lw-` key and OTLP endpoint. Without `project`, the
   * caller's personal project; with an authorised project id or slug, that
   * project instead, so separate machines can retain their own key.
   */
  .post("/api/auth/cli/governance/ingestion-key", "mintCliIngestionKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    const gate = await admittedMember({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const parsed = governanceCliIngestionKeyRequestSchema.safeParse(posted(raw));

    if (!parsed.success) return refuse("invalid_request", parsed.error.message, 400);

    return renderIngestionKey(
      await app.cliCredentials().mintIngestionKey({
        caller: gate.caller,
        sourceType: parsed.data.source_type,
        projectRef: parsed.data.project,
        deviceLabel: parsed.data.device_label,
      }),
    );
  })

  /**
   * The CLI's cache-liveness pre-flight: revoking a key on the platform would
   * otherwise silently brick direct telemetry, because the wrapper reuses a
   * locally cached token forever.
   */
  .get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys")
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const keys = await app.governance().ingestionKeyListForPersonalProject({
      userId: gate.caller.user_id,
      organizationId: gate.caller.organization_id,
    });

    return answer({ keys: keys.map(toIngestionKey) });
  })

  /**
   * What became of one of the caller's own keys, asked when the collector
   * rejects the token a device exports with. `unknown` is a 200, not a 404, so
   * a CLI can tell "no such key of yours" from "a server too old to have this
   * route".
   */
  .get("/api/auth/cli/governance/ingestion-keys/:lookup_id", "readCliIngestionKeyState")
  .withParams(governanceCliKeyLookupParamsSchema)
  .withAccess(CLI_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const gate = await admitted({ app, request });

    if ("refusal" in gate) return gate.refusal;

    const lookupId = input.lookup_id;
    const key = await app.governance().tryDescribePersonalIngestionKey({
      userId: gate.caller.user_id,
      organizationId: gate.caller.organization_id,
      lookupId,
    });

    if (!key) return answer({ lookup_id: lookupId, status: "unknown" });

    return answer({
      lookup_id: lookupId,
      status: key.live ? "live" : "revoked",
      source_type: key.sourceType,
      revocation_cause: key.revocationCause,
    });
  })

  .build();
