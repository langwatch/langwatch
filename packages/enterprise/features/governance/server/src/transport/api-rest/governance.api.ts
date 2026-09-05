// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
/**
 * Public Hono REST API for governance resources.
 *
 * Mounted at `/api/governance/<resource>`. Every verb dispatches through
 * the same service-layer function the tRPC routers call — Hono and tRPC
 * are two surfaces over one body of business logic. CLI + MCP land on
 * top of these routes via the generated OpenAPI spec.
 *
 * Auth: project API key (`Authorization: Bearer <projectApiKey>` or
 * `X-Auth-Token`). The org for the call is derived from the project's
 * team. Scoped API keys additionally must satisfy the per-route ceiling permission
 * (`aiTools:view` / `aiTools:manage`); legacy project tokens bypass the
 * ceiling — same model as `gateway-platform`.
 *
 * Audit: writes are emitted by the service layer; surface attribution
 * (which API surface initiated the change) is threaded through later
 * once tRPC + CLI + MCP are all online.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import { z } from "zod";
import { apiKeyPermission } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolver,
} from "@langwatch/api/rest";
import { isZodLikeError } from "@langwatch/handled-error";
import type { GovernanceApp, GovernanceProjectCaller } from "#app/governance.app";

const logger = createLogger("langwatch:api:governance");

// Org governance template administration (list-with-secrets, create,
// update, archive, clone) must be driven by a real user, not a shared
// project key: legacy project tokens bypass the aiTools:manage ceiling
// (same model as gateway-platform), so without this a project-key holder
// could read every org template's OTTL rules and mutate org config. The
// per-route ceiling permission is declared via apiKeyPermission(...) on each
// route; this extra guard enforces the user-bound requirement on top.
const requireUserBoundCaller: MiddlewareHandler<{
  Variables: Variables;
}> = async (c, next) => {
  if (!c.get("apiKeyUserId")) {
    return c.json(
      {
        error: {
          type: "forbidden",
          code: "user_token_required",
          message:
            "This endpoint requires a user-bound API key; legacy project API keys cannot administer organization governance templates.",
        },
      },
      403,
    );
  }
  return next();
};

type Variables = AppRestProjectVariables;

// ── Shared DTO + error schemas ──────────────────────────────────────────────

const ingestionTemplateDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  source_type: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  icon_asset: z.string().nullable(),
  credential_schema: z.string().nullable(),
  ottl_rules: z.string(),
  platform_published: z.boolean(),
  enabled: z.boolean(),
  organization_id: z.string().nullable(),
});

const errorSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string(),
    message: z.string(),
  }),
});

// ── Request schemas ─────────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  source_type: z.string(),
  display_name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  icon_asset: z.string().max(20_000).optional(),
  credential_schema: z.enum(["otlp_token", "static_api_key", "agent_id"]).nullable().optional(),
  ottl_rules: z.string().max(50_000).optional(),
});

const updateOttlRulesSchema = z.object({
  ottl_rules: z.string().max(50_000),
});

const cloneTemplateSchema = z.object({
  source_template_id: z.string(),
});

const templateParamsSchema = z.object({ id: z.string().min(1) });

const templateListSchema = z.object({ data: z.array(ingestionTemplateDtoSchema) });
const templateDetailSchema = z.object({ ingestion_template: ingestionTemplateDtoSchema });
const templateArchivedSchema = z.object({ archived: z.literal(true) });

// ── Helpers ─────────────────────────────────────────────────────────────────

function toTemplateDto(row: {
  id: string;
  slug: string;
  sourceType: string;
  displayName: string;
  description: string | null;
  iconAsset: string | null;
  credentialSchema: string | null;
  ottlRules: string;
  platformPublished: boolean;
  enabled: boolean;
  organizationId: string | null;
}) {
  return {
    id: row.id,
    slug: row.slug,
    source_type: row.sourceType,
    display_name: row.displayName,
    description: row.description,
    icon_asset: row.iconAsset,
    credential_schema: row.credentialSchema,
    ottl_rules: row.ottlRules,
    platform_published: row.platformPublished,
    enabled: row.enabled,
    organization_id: row.organizationId,
  };
}

/**
 * A template failure the writing routes answer in this family's own envelope.
 *
 * Only the writes map these: reading one template by id has always let a
 * missing row fall through to the boundary, which answers the flat body its
 * caller parses. Carrying the rendered pair on the throw keeps that split
 * exactly where it was when each handler caught for itself.
 */
class MappedTemplateRefusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    readonly body: { error: { type: string; code: string; message: string } },
  ) {
    super(body.error.message);
    this.name = "MappedTemplateRefusal";
  }
}

/** Re-raises a mapped template failure; anything else travels untouched. */
function rethrowMappedTemplateError(error: unknown): never {
  const mapped = mapTemplateError(error);
  if (mapped) throw new MappedTemplateRefusal(mapped.status, mapped.body);
  throw error;
}

function mapTemplateError(error: unknown): {
  status: 400 | 403 | 404;
  body: { error: { type: string; code: string; message: string } };
} | null {
  if (error instanceof TemplateNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          type: "not_found",
          code: "ingestion_template_not_found",
          message: error.message,
        },
      },
    };
  }
  if (error instanceof PlatformTemplateImmutableError) {
    return {
      status: 403,
      body: {
        error: {
          type: "forbidden",
          code: "platform_template_immutable",
          message: error.message,
        },
      },
    };
  }
  if (error instanceof InvalidSourceTypeError) {
    return {
      status: 400,
      body: {
        error: {
          type: "bad_request",
          code: "invalid_source_type",
          message: error.message,
        },
      },
    };
  }
  return null;
}

/**
 * Resolves the audit-surface tag for the current request. Defaults to
 * `hono` (the route mount). The `langwatch` CLI sends
 * `X-LangWatch-Surface: cli` on its mutating governance calls so the
 * audit row reads `metadata.surface = 'cli'` end-to-end (per umbrella
 * spec @audit-uniform). Only `cli` is currently honored — other values
 * fall through to the default to prevent spoofing of in-process
 * surfaces (`trpc` / `mcp`) over the wire.
 */
function resolveSurfaceFromRequest(c: {
  req: { header: (name: string) => string | undefined };
}): "hono" | "cli" {
  const declared = c.req.header("X-LangWatch-Surface")?.toLowerCase();
  return declared === "cli" ? "cli" : "hono";
}

/**
 * Who this request is attributed to, read off the Hono context.
 *
 * Reading the caller is the transport's job; deciding what to record when
 * there is no user behind the key is not, so the `svc_<projectId>` fallback
 * lives on {@link GovernanceApp} where every door gets the same answer.
 */
function callerOf(c: Context<{ Variables: Variables }>): GovernanceProjectCaller {
  return {
    projectId: c.get("project").id,
    userId: c.get("apiKeyUserId") ?? null,
    surface: resolveSurfaceFromRequest(c),
  };
}

// ── App ─────────────────────────────────────────────────────────────────────

/**
 * The governance REST family.
 *
 * The feature's application arrives as an argument rather than being read off
 * the request, so the family can be mounted into any process holding one — and
 * so this door and the two tRPC doors answer from the SAME object rather than
 * from two descriptions of it.
 */
export function createGovernanceRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  app: () => GovernanceApp;
}): MountableRestApp {
  const { security, app } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "governance",
    basePath: "/api/governance",
    errorEnvelope: "legacy",
    errorHandler: governanceErrorHandler,
  });

  const view = policy(apiKeyPermission("aiTools:view"));
  const manage = policy(apiKeyPermission("aiTools:manage"));

  const listForMemberHandler = async (c: Context) => ({
    data: (await app().listIngestionTemplatesForMember({ projectId: c.get("project").id })).map(
      toTemplateDto,
    ),
  });

  const listForAdminHandler = async (c: Context) => ({
    data: (await app().listIngestionTemplatesForAdmin({ projectId: c.get("project").id })).map(
      toTemplateDto,
    ),
  });

  const getHandler = async (c: Context, input: z.infer<typeof templateParamsSchema>) => ({
    ingestion_template: toTemplateDto(
      await app().getIngestionTemplate({ projectId: c.get("project").id, id: input.id }),
    ),
  });

  const createHandler = async (c: Context, input: z.infer<typeof createTemplateSchema>) => {
    const by = callerOf(c);
    const row = await app()
      .createIngestionTemplate(
        {
          sourceType: input.source_type,
          displayName: input.display_name,
          description: input.description ?? null,
          iconAsset: input.icon_asset ?? null,
          // `otlp_token` is this door's own vocabulary for "no credential
          // schema at all"; the domain stores it as absent.
          credentialSchema:
            input.credential_schema === "otlp_token" ? null : (input.credential_schema ?? null),
          ottlRules: input.ottl_rules,
        },
        by,
      )
      .catch(rethrowMappedTemplateError);
    logger.info(
      { templateId: row.id, projectId: by.projectId, apiKeyUserId: by.userId },
      "ingestion template created via REST",
    );
    return { ingestion_template: toTemplateDto(row) };
  };

  const updateOttlRulesHandler = async (
    c: Context,
    input: z.infer<typeof templateParamsSchema> & z.infer<typeof updateOttlRulesSchema>,
  ) => ({
    ingestion_template: toTemplateDto(
      await app()
        .updateIngestionTemplateOttlRules(
          { id: input.id, ottlRules: input.ottl_rules },
          callerOf(c),
        )
        .catch(rethrowMappedTemplateError),
    ),
  });

  const archiveHandler = async (c: Context, input: z.infer<typeof templateParamsSchema>) => {
    await app()
      .archiveIngestionTemplate({ id: input.id }, callerOf(c))
      .catch(rethrowMappedTemplateError);
    return { archived: true as const };
  };

  const cloneHandler = async (c: Context, input: z.infer<typeof cloneTemplateSchema>) => ({
    ingestion_template: toTemplateDto(
      await app()
        .cloneIngestionTemplate({ sourceTemplateId: input.source_template_id }, callerOf(c))
        .catch(rethrowMappedTemplateError),
    ),
  });

  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: resolver(errorSchema) } },
  });

  return (
    service
      .registerRoute(
        "get",
        "/ingestion-templates",
        MANAGEMENT_API_VERSION,
        listForMemberHandler,
        (b) =>
          view(b)
            .withOutput(templateListSchema)
            .withDocs({
              operationId: "listIngestionTemplates",
              summary: "List ingestion templates",
              tags: ["Governance / Ingestion Templates"],
              description:
                "Returns the union of platform-published default templates and any org-authored templates visible to the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.",
              responses: { ...baseResponses },
            }),
      )
      .registerRoute(
        "get",
        "/ingestion-templates/admin",
        MANAGEMENT_API_VERSION,
        listForAdminHandler,
        (b) =>
          manage(b)
            .withMiddleware(requireUserBoundCaller)
            .withOutput(templateListSchema)
            .withDocs({
              operationId: "listIngestionTemplatesForAdmin",
              summary: "List ingestion templates (admin shape, includes OTTL)",
              tags: ["Governance / Ingestion Templates"],
              description:
                "Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by admin tooling to render the transparency block / authoring drawer.",
              responses: { ...baseResponses },
            }),
      )
      // The response carries the canonical `ottl_rules`, which is exactly what
      // /ingestion-templates blanks and what /ingestion-templates/admin gates on
      // aiTools:manage plus a user-bound caller. One row at a time is not a
      // cheaper read of the same secret, so it is gated the same way.
      .registerRoute("get", "/ingestion-templates/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        manage(b)
          .withMiddleware(requireUserBoundCaller)
          .withParams(templateParamsSchema)
          .withOutput(templateDetailSchema)
          .withDocs({
            operationId: "getIngestionTemplate",
            summary: "Get ingestion template",
            tags: ["Governance / Ingestion Templates"],
            description:
              "Single-template lookup by id, scoped to the caller's organization, including the canonical `ottl_rules`. Cross-org probes collapse to 404 (no enumeration vector). Members read the same row without `ottl_rules` from GET /ingestion-templates.",
            responses: { ...baseResponses, 404: errorResponse("Not found") },
          }),
      )
      .registerRoute("post", "/ingestion-templates", MANAGEMENT_API_VERSION, createHandler, (b) =>
        manage(b)
          .withMiddleware(requireUserBoundCaller)
          .withInput(createTemplateSchema)
          .withOutput(templateDetailSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createIngestionTemplate",
            summary: "Create org-authored ingestion template",
            tags: ["Governance / Ingestion Templates"],
            description:
              "Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform defaults via POST /ingestion-templates/clone instead.",
            responses: { ...baseResponses, 400: errorResponse("Validation error") },
          }),
      )
      .registerRoute(
        "patch",
        "/ingestion-templates/:id/ottl-rules",
        MANAGEMENT_API_VERSION,
        updateOttlRulesHandler,
        (b) =>
          manage(b)
            .withMiddleware(requireUserBoundCaller)
            .withParams(templateParamsSchema)
            .withInput(updateOttlRulesSchema)
            .withOutput(templateDetailSchema)
            .withDocs({
              operationId: "updateIngestionTemplateOttlRules",
              summary: "Replace ottl_rules on an org-authored template",
              tags: ["Governance / Ingestion Templates"],
              description:
                "Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a platform row before editing it.",
              responses: {
                ...baseResponses,
                403: errorResponse("Platform template immutable"),
                404: errorResponse("Template not found"),
              },
            }),
      )
      .registerRoute(
        "delete",
        "/ingestion-templates/:id",
        MANAGEMENT_API_VERSION,
        archiveHandler,
        (b) =>
          manage(b)
            .withMiddleware(requireUserBoundCaller)
            .withParams(templateParamsSchema)
            .withOutput(templateArchivedSchema)
            .withDocs({
              operationId: "archiveIngestionTemplate",
              summary: "Soft-archive an org-authored template",
              tags: ["Governance / Ingestion Templates"],
              description:
                "Marks the row archived; existing ingestion keys continue to land traces but the row disappears from list views. Platform-published rows reject with 403.",
              responses: {
                ...baseResponses,
                403: errorResponse("Platform template immutable"),
                404: errorResponse("Template not found"),
              },
            }),
      )
      .registerRoute(
        "post",
        "/ingestion-templates/clone",
        MANAGEMENT_API_VERSION,
        cloneHandler,
        (b) =>
          manage(b)
            .withMiddleware(requireUserBoundCaller)
            .withInput(cloneTemplateSchema)
            .withOutput(templateDetailSchema)
            .withStatus(201)
            .withDocs({
              operationId: "cloneIngestionTemplate",
              summary: "Clone a platform-published template into the caller's org",
              tags: ["Governance / Ingestion Templates"],
              description:
                "Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.",
              responses: { ...baseResponses, 404: errorResponse("Source template not found") },
            }),
      )
      .build()
  );
}

/**
 * This family's own refusals, in the nested envelope its callers parse.
 *
 * A write that mapped a template failure answers the pair it carries, and a
 * request the schema rejects answers 400 `validation_error` in the same shape
 * — which is where the door's hand-rolled `safeParse` used to put it. Anything
 * else is the boundary's.
 */
const governanceErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof MappedTemplateRefusal) return c.json(error.body, error.status);
    if (isZodLikeError(error)) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: error.message,
          },
        },
        400,
      );
    }
    return boundary(error, c);
  };
