// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  IngestionTemplateService,
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
} from "@ee/governance/services/ingestionTemplate.service";
import {
  BindingAlreadyExistsError,
  BindingNotFoundError,
  IngestionTemplateNotFoundError,
  PersonalProjectMissingError,
  UserIngestionBindingService,
} from "@ee/governance/services/userIngestionBinding.service";
import type { Prisma } from "@prisma/client";
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
import type { MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { apiKeyPermission, createProjectApp } from "~/server/api/security";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

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

type Variables = AuthMiddlewareVariables;

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
  credential_schema: z
    .enum(["otlp_token", "static_api_key", "agent_id"])
    .nullable()
    .optional(),
  ottl_rules: z.string().max(50_000).optional(),
});

const updateOttlRulesSchema = z.object({
  ottl_rules: z.string().max(50_000),
});

const cloneTemplateSchema = z.object({
  source_template_id: z.string(),
});

// ── UserIngestionBinding DTOs + request schemas ─────────────────────────────

const userIngestionBindingDtoSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  template_id: z.string(),
  personal_project_id: z.string(),
  organization_id: z.string(),
  binding_access_token_prefix: z.string(),
  enabled: z.boolean(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const installBindingSchema = z.object({
  template_id: z.string().min(1),
  // Opaque metadata for templates whose credentialSchema is
  // `static_api_key` or `agent_id`. v1 ships only otlp_token; the field
  // stays null for those rows but the path is wired for v2.
  encrypted_credential: z.unknown().optional(),
});

function toBindingDto(row: {
  id: string;
  userId: string;
  templateId: string;
  personalProjectId: string;
  organizationId: string;
  bindingAccessTokenPrefix: string;
  enabled: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    user_id: row.userId,
    template_id: row.templateId,
    personal_project_id: row.personalProjectId,
    organization_id: row.organizationId,
    binding_access_token_prefix: row.bindingAccessTokenPrefix,
    enabled: row.enabled,
    last_seen_at: row.lastSeenAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapBindingError(error: unknown): {
  status: 404 | 409 | 412;
  body: { error: { type: string; code: string; message: string } };
} | null {
  if (error instanceof PersonalProjectMissingError) {
    return {
      status: 412,
      body: {
        error: {
          type: "precondition_failed",
          code: "personal_project_missing",
          message: error.message,
        },
      },
    };
  }
  if (error instanceof IngestionTemplateNotFoundError) {
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
  if (error instanceof BindingNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          type: "not_found",
          code: "binding_not_found",
          message: error.message,
        },
      },
    };
  }
  if (error instanceof BindingAlreadyExistsError) {
    return {
      status: 409,
      body: {
        error: {
          type: "conflict",
          code: "binding_already_exists",
          message: error.message,
        },
      },
    };
  }
  return null;
}

function callerUserIdRequired(
  apiKeyUserId: string | undefined,
): { ok: true; userId: string } | { ok: false } {
  // UserIngestionBinding routes require a real human caller — the
  // service-layer cross-bind invariant enforces
  // `Project.ownerUserId === callerUserId`. A synthetic `svc_<projectId>`
  // wouldn't own a personal project, so legacy project tokens that don't
  // resolve to a User MUST be rejected here.
  if (!apiKeyUserId) return { ok: false };
  return { ok: true, userId: apiKeyUserId };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function orgIdForProject(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!project) throw new Error(`project ${projectId} missing`);
  return project.team.organizationId;
}

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

function callerUserIdFromContext(
  apiKeyUserId: string | undefined,
  projectId: string,
): string {
  return apiKeyUserId ?? `svc_${projectId}`;
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

// ── App ─────────────────────────────────────────────────────────────────────

const secured = createProjectApp({ basePath: "/api/governance" });

// ── Ingestion Templates ───────────────────────────────────────────────

secured.access(apiKeyPermission("aiTools:view")).get(
  "/ingestion-templates",
  describeRoute({
    summary: "List ingestion templates",
    description:
      "Returns the union of platform-published default templates and any org-authored templates visible to the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      200: {
        description: "Templates visible to the caller",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ data: z.array(ingestionTemplateDtoSchema) }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const rows = await service.listForUser({ organizationId });
    return c.json({ data: rows.map(toTemplateDto) });
  },
);

secured.access(apiKeyPermission("aiTools:manage")).get(
  "/ingestion-templates/admin",
  describeRoute({
    summary: "List ingestion templates (admin shape, includes OTTL)",
    description:
      "Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by admin tooling to render the transparency block / authoring drawer.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      200: {
        description: "Admin templates",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ data: z.array(ingestionTemplateDtoSchema) }),
            ),
          },
        },
      },
    },
  }),
  requireUserBoundCaller,
  async (c) => {
    const project = c.get("project");
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const rows = await service.listForOrgAdmin({ organizationId });
    return c.json({ data: rows.map(toTemplateDto) });
  },
);

secured.access(apiKeyPermission("aiTools:view")).get(
  "/ingestion-templates/:id",
  describeRoute({
    summary: "Get ingestion template",
    description:
      "Single-template lookup by id, scoped to the caller's organization. Cross-org probes collapse to 404 (no enumeration vector).",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      200: {
        description: "Template detail",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ ingestion_template: ingestionTemplateDtoSchema }),
            ),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const row = await service.findByIdForOrg({ id, organizationId });
    if (!row) {
      return c.json(
        {
          error: {
            type: "not_found",
            code: "ingestion_template_not_found",
            message: "ingestion template not found",
          },
        },
        404,
      );
    }
    return c.json({ ingestion_template: toTemplateDto(row) });
  },
);

secured.access(apiKeyPermission("aiTools:manage")).post(
  "/ingestion-templates",
  describeRoute({
    summary: "Create org-authored ingestion template",
    description:
      "Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform defaults via POST /ingestion-templates/clone instead.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      201: {
        description: "Template created",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ ingestion_template: ingestionTemplateDtoSchema }),
            ),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireUserBoundCaller,
  async (c) => {
    const project = c.get("project");
    const body = createTemplateSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: body.error.message,
          },
        },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const callerUserId = callerUserIdFromContext(
      c.get("apiKeyUserId") ?? undefined,
      project.id,
    );
    try {
      const row = await service.createOrgTemplate({
        organizationId,
        callerUserId,
        sourceType: body.data.source_type,
        displayName: body.data.display_name,
        description: body.data.description ?? null,
        iconAsset: body.data.icon_asset ?? null,
        credentialSchema:
          body.data.credential_schema === "otlp_token"
            ? null
            : (body.data.credential_schema ?? null),
        ottlRules: body.data.ottl_rules,
        surface: resolveSurfaceFromRequest(c),
      });
      logger.info(
        { templateId: row.id, organizationId, callerUserId },
        "ingestion template created via REST",
      );
      return c.json({ ingestion_template: toTemplateDto(row) }, 201);
    } catch (err) {
      const mapped = mapTemplateError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

secured.access(apiKeyPermission("aiTools:manage")).patch(
  "/ingestion-templates/:id/ottl-rules",
  describeRoute({
    summary: "Replace ottl_rules on an org-authored template",
    description:
      "Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a platform row before editing it.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ ingestion_template: ingestionTemplateDtoSchema }),
            ),
          },
        },
      },
      403: {
        description: "Platform template immutable",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      404: {
        description: "Template not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireUserBoundCaller,
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = updateOttlRulesSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: body.error.message,
          },
        },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const callerUserId = callerUserIdFromContext(
      c.get("apiKeyUserId") ?? undefined,
      project.id,
    );
    try {
      const row = await service.updateOttlRules({
        organizationId,
        callerUserId,
        id,
        ottlRules: body.data.ottl_rules,
        surface: resolveSurfaceFromRequest(c),
      });
      return c.json({ ingestion_template: toTemplateDto(row) });
    } catch (err) {
      const mapped = mapTemplateError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

secured.access(apiKeyPermission("aiTools:manage")).delete(
  "/ingestion-templates/:id",
  describeRoute({
    summary: "Soft-archive an org-authored template",
    description:
      "Marks the row archived; existing UserIngestionBindings continue to land traces but the row disappears from list views. Platform-published rows reject with 403.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      200: {
        description: "Archived",
        content: {
          "application/json": {
            schema: resolver(z.object({ archived: z.literal(true) })),
          },
        },
      },
      403: {
        description: "Platform template immutable",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      404: {
        description: "Template not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireUserBoundCaller,
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const callerUserId = callerUserIdFromContext(
      c.get("apiKeyUserId") ?? undefined,
      project.id,
    );
    try {
      await service.archiveOrgTemplate({
        organizationId,
        callerUserId,
        id,
        surface: resolveSurfaceFromRequest(c),
      });
      return c.json({ archived: true as const });
    } catch (err) {
      const mapped = mapTemplateError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

secured.access(apiKeyPermission("aiTools:manage")).post(
  "/ingestion-templates/clone",
  describeRoute({
    summary: "Clone a platform-published template into the caller's org",
    description:
      "Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.",
    tags: ["Governance / Ingestion Templates"],
    responses: {
      ...baseResponses,
      201: {
        description: "Cloned",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ ingestion_template: ingestionTemplateDtoSchema }),
            ),
          },
        },
      },
      404: {
        description: "Source template not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  requireUserBoundCaller,
  async (c) => {
    const project = c.get("project");
    const body = cloneTemplateSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: body.error.message,
          },
        },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = IngestionTemplateService.create(prisma);
    const callerUserId = callerUserIdFromContext(
      c.get("apiKeyUserId") ?? undefined,
      project.id,
    );
    try {
      const row = await service.cloneFromPlatform({
        organizationId,
        callerUserId,
        sourceTemplateId: body.data.source_template_id,
        surface: resolveSurfaceFromRequest(c),
      });
      return c.json({ ingestion_template: toTemplateDto(row) }, 201);
    } catch (err) {
      const mapped = mapTemplateError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

// ── User Ingestion Bindings ───────────────────────────────────────────

secured.access(apiKeyPermission("organization:view")).get(
  "/user-ingestion-bindings",
  describeRoute({
    summary: "List the caller's bindings",
    description:
      "Returns the caller's own UserIngestionBindings within the organization derived from the project API key. Bindings are caller-scoped: cross-user reads are not possible. Powers the /me Trace Ingest tile-grid's installed-state lookup.",
    tags: ["Governance / User Ingestion Bindings"],
    responses: {
      ...baseResponses,
      200: {
        description: "Caller bindings",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(userIngestionBindingDtoSchema),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const caller = callerUserIdRequired(c.get("apiKeyUserId") ?? undefined);
    if (!caller.ok) {
      return c.json(
        {
          error: {
            type: "forbidden",
            code: "human_caller_required",
            message:
              "UserIngestionBinding routes require a user-bound API key; legacy project API keys cannot list user-scoped bindings.",
          },
        },
        403,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = UserIngestionBindingService.create(prisma);
    const rows = await service.listForCaller({
      callerUserId: caller.userId,
      organizationId,
    });
    return c.json({ data: rows.map(toBindingDto) });
  },
);

secured.access(apiKeyPermission("organization:view")).post(
  "/user-ingestion-bindings",
  describeRoute({
    summary: "Install a binding for the caller",
    description:
      "Creates a UserIngestionBinding for the caller against the given template_id. The personal project is server-resolved from the caller's user id and the org derived from the project API key — input shape MUST NOT carry personalProjectId (cross-bind structural impossibility per spec). Returns the issued plaintext token EXACTLY ONCE in the `token` field; subsequent reads only see `binding_access_token_prefix`.",
    tags: ["Governance / User Ingestion Bindings"],
    responses: {
      ...baseResponses,
      201: {
        description: "Binding installed; token returned once",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                binding: userIngestionBindingDtoSchema,
                token: z.string(),
              }),
            ),
          },
        },
      },
      404: {
        description: "Template not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      409: {
        description: "Binding already exists",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      412: {
        description: "Personal project missing for caller",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const caller = callerUserIdRequired(c.get("apiKeyUserId") ?? undefined);
    if (!caller.ok) {
      return c.json(
        {
          error: {
            type: "forbidden",
            code: "human_caller_required",
            message:
              "UserIngestionBinding install requires a user-bound API key; legacy project API keys cannot bind a personal project.",
          },
        },
        403,
      );
    }
    const body = installBindingSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: body.error.message,
          },
        },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = UserIngestionBindingService.create(prisma);
    try {
      const result = await service.install({
        callerUserId: caller.userId,
        organizationId,
        templateId: body.data.template_id,
        encryptedCredential: body.data.encrypted_credential as
          | Prisma.InputJsonValue
          | undefined,
        surface: resolveSurfaceFromRequest(c),
      });
      logger.info(
        {
          bindingId: result.binding.id,
          templateId: result.binding.templateId,
          userId: caller.userId,
          organizationId,
        },
        "user ingestion binding installed via REST",
      );
      return c.json(
        { binding: toBindingDto(result.binding), token: result.token },
        201,
      );
    } catch (err) {
      const mapped = mapBindingError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

secured.access(apiKeyPermission("organization:view")).delete(
  "/user-ingestion-bindings/:id",
  describeRoute({
    summary: "Uninstall (soft-archive) a binding",
    description:
      "Soft-archives the binding owned by the caller. The token stops authenticating new traces immediately. Historical trace rows are retained.",
    tags: ["Governance / User Ingestion Bindings"],
    responses: {
      ...baseResponses,
      200: {
        description: "Uninstalled",
        content: {
          "application/json": {
            schema: resolver(z.object({ uninstalled: z.literal(true) })),
          },
        },
      },
      404: {
        description: "Binding not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const caller = callerUserIdRequired(c.get("apiKeyUserId") ?? undefined);
    if (!caller.ok) {
      return c.json(
        {
          error: {
            type: "forbidden",
            code: "human_caller_required",
            message:
              "UserIngestionBinding routes require a user-bound API key.",
          },
        },
        403,
      );
    }
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = UserIngestionBindingService.create(prisma);
    try {
      await service.uninstall({
        callerUserId: caller.userId,
        organizationId,
        bindingId: id,
        surface: resolveSurfaceFromRequest(c),
      });
      return c.json({ uninstalled: true as const });
    } catch (err) {
      const mapped = mapBindingError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

secured.access(apiKeyPermission("organization:view")).post(
  "/user-ingestion-bindings/:id/rotate",
  describeRoute({
    summary: "Rotate the binding access token (hard-cut v1)",
    description:
      "Mints a fresh plaintext token for an existing binding and invalidates the previous token immediately. Caller MUST persist the returned `token` — LangWatch stores only a hash.",
    tags: ["Governance / User Ingestion Bindings"],
    responses: {
      ...baseResponses,
      200: {
        description: "Rotated; new token returned once",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                binding: userIngestionBindingDtoSchema,
                token: z.string(),
              }),
            ),
          },
        },
      },
      404: {
        description: "Binding not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const caller = callerUserIdRequired(c.get("apiKeyUserId") ?? undefined);
    if (!caller.ok) {
      return c.json(
        {
          error: {
            type: "forbidden",
            code: "human_caller_required",
            message:
              "UserIngestionBinding routes require a user-bound API key.",
          },
        },
        403,
      );
    }
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = UserIngestionBindingService.create(prisma);
    try {
      const result = await service.rotateToken({
        callerUserId: caller.userId,
        organizationId,
        bindingId: id,
        surface: resolveSurfaceFromRequest(c),
      });
      return c.json({
        binding: toBindingDto(result.binding),
        token: result.token,
      });
    } catch (err) {
      const mapped = mapBindingError(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }
  },
);

export const app = secured.hono;
