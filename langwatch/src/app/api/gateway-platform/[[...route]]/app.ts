/**
 * Public REST API for managing AI Gateway resources from SDKs, CLIs, and
 * CI pipelines. Parallels the `virtualKeys` / `gatewayProviders` /
 * `gatewayBudgets` tRPC routers consumed by the UI.
 *
 * Auth: standard project API key (`Authorization: Bearer <projectApiKey>`
 * or `X-Auth-Token`). All writes are audited to `GatewayAuditLog` with the
 * actor set to `svc_<projectApiKeyId>` (machine principal) rather than a
 * human user — the audit repository already accepts a null actorUserId for
 * this case.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { prisma } from "~/server/db";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { GatewayProviderCredentialService } from "~/server/gateway/providerCredential.service";
import {
  VirtualKeyService,
  type CreateVirtualKeyInput,
} from "~/server/gateway/virtualKey.service";
import { virtualKeyConfigSchema } from "~/server/gateway/virtualKey.config";
import { toVirtualKeySnakeDto } from "~/server/gateway/virtualKey.dto";
import { createLogger } from "~/utils/logger/server";

import {
  type AuthMiddlewareVariables,
  authMiddleware,
  handleError,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";

const logger = createLogger("langwatch:api:gateway-platform");

patchZodOpenapi();

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// These mirror the shapes returned by toVirtualKeySnakeDto / budget DTO /
// provider DTO. Kept in-file to stay a single source of truth per app.

const virtualKeyDtoSchema = z.object({
  id: z.string(),
  display_prefix: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  environment: z.enum(["live", "test"]),
  status: z.enum(["active", "revoked"]),
  principal_user_id: z.string().nullable(),
  provider_credential_ids: z.array(z.string()),
  revision: z.string(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});

const budgetDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  scope_type: z.string(),
  scope_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  window: z.string(),
  on_breach: z.enum(["BLOCK", "WARN"]),
  limit_usd: z.string(),
  spent_usd: z.string(),
  resets_at: z.string(),
  archived_at: z.string().nullable(),
});

const providerDtoSchema = z.object({
  id: z.string(),
  disabled_at: z.string().nullable().optional(),
});

const errorSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string(),
    message: z.string(),
  }),
});

type Variables = AuthMiddlewareVariables;

/**
 * Best-effort organization lookup for the project behind the API key.
 * Cached off the project row we already fetched in `authMiddleware`.
 */
async function orgIdForProject(projectId: string): Promise<string> {
  const team = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!team) throw new Error(`project ${projectId} missing team`);
  return team.team.organizationId;
}

const createVirtualKeySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  environment: z.enum(["live", "test"]).default("live"),
  principal_user_id: z.string().nullable().optional(),
  provider_credential_ids: z.array(z.string()).min(1),
  config: virtualKeyConfigSchema.partial().optional(),
});

const updateVirtualKeySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  provider_credential_ids: z.array(z.string()).min(1).optional(),
  config: virtualKeyConfigSchema.partial().optional(),
});

const createBudgetSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ORGANIZATION"), organization_id: z.string() }),
    z.object({ kind: z.literal("TEAM"), team_id: z.string() }),
    z.object({ kind: z.literal("PROJECT"), project_id: z.string() }),
    z.object({ kind: z.literal("VIRTUAL_KEY"), virtual_key_id: z.string() }),
    z.object({ kind: z.literal("PRINCIPAL"), principal_user_id: z.string() }),
  ]),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL"]),
  limit_usd: z.number().positive().or(z.string()),
  on_breach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
});

const toVkDto = toVirtualKeySnakeDto;

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/gateway/v1")
  .use(tracerMiddleware({ name: "gateway-platform" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── Virtual keys ────────────────────────────────────────────────────────

  .get(
    "/virtual-keys",
    describeRoute({
      summary: "List virtual keys",
      description:
        "Returns every non-archived virtual key in the caller's project, ordered by creation time.",
      tags: ["Virtual Keys"],
      responses: {
        ...baseResponses,
        200: {
          description: "Virtual keys for the project",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ data: z.array(virtualKeyDtoSchema) }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const service = VirtualKeyService.create(prisma);
      const rows = await service.getAll(project.id);
      return c.json({ data: rows.map(toVkDto) });
    },
  )

  .post(
    "/virtual-keys",
    describeRoute({
      summary: "Create virtual key",
      description:
        "Mints a new virtual key and returns the secret exactly once. The caller MUST persist the `secret` value — LangWatch stores only a hash.",
      tags: ["Virtual Keys"],
      responses: {
        ...baseResponses,
        201: {
          description: "Virtual key created",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  virtual_key: virtualKeyDtoSchema,
                  secret: z.string(),
                }),
              ),
            },
          },
        },
        400: {
          description: "Validation error",
          content: {
            "application/json": { schema: resolver(errorSchema) },
          },
        },
      },
    }),
    async (c) => {
    const project = c.get("project");
    const body = createVirtualKeySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { type: "bad_request", code: "validation_error", message: body.error.message } },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const input: CreateVirtualKeyInput = {
      projectId: project.id,
      organizationId,
      name: body.data.name,
      description: body.data.description ?? null,
      environment: body.data.environment,
      principalUserId: body.data.principal_user_id ?? null,
      providerCredentialIds: body.data.provider_credential_ids,
      config: body.data.config,
      // Machine principal — no human actor.
      actorUserId: machineActorForProject(project.id),
    };
    const { virtualKey, secret } = await service.create(input);
    logger.info(
      { projectId: project.id, vkId: virtualKey.id },
      "Created virtual key via REST",
    );
    // Secret is returned exactly once — caller MUST persist it.
    return c.json(
      { virtual_key: toVkDto(virtualKey), secret },
      201,
    );
  })

  .get("/virtual-keys/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const service = VirtualKeyService.create(prisma);
    const vk = await service.getById(id, project.id);
    if (!vk) {
      return c.json(
        { error: { type: "not_found", code: "virtual_key_not_found", message: "virtual key not found" } },
        404,
      );
    }
    return c.json({ virtual_key: toVkDto(vk) });
  })

  .patch("/virtual-keys/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = updateVirtualKeySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { type: "bad_request", code: "validation_error", message: body.error.message } },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const updated = await service.update({
      id,
      projectId: project.id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
      name: body.data.name,
      description: body.data.description ?? null,
      providerCredentialIds: body.data.provider_credential_ids,
      config: body.data.config,
    });
    return c.json({ virtual_key: toVkDto(updated) });
  })

  .post(
    "/virtual-keys/:id/rotate",
    describeRoute({
      summary: "Rotate virtual key secret",
      description:
        "Mints a fresh secret for an existing VK. The old secret remains valid for 24h (grace window) so in-flight clients can roll over.",
      tags: ["Virtual Keys"],
      responses: {
        ...baseResponses,
        200: {
          description: "Rotated",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  virtual_key: virtualKeyDtoSchema,
                  secret: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const { virtualKey, secret } = await service.rotate({
      id,
      projectId: project.id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ virtual_key: toVkDto(virtualKey), secret });
  })

  .post("/virtual-keys/:id/revoke", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const updated = await service.revoke({
      id,
      projectId: project.id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ virtual_key: toVkDto(updated) });
  })

  // ── Gateway provider bindings ───────────────────────────────────────────

  .get(
    "/providers",
    describeRoute({
      summary: "List provider bindings",
      description:
        "Lists every gateway-bound model-provider credential for the caller's project, including health and rate-limit settings.",
      tags: ["Providers"],
      responses: {
        ...baseResponses,
        200: {
          description: "Provider bindings",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.array(
                    z.object({
                      id: z.string(),
                      model_provider_id: z.string(),
                      model_provider_name: z.string(),
                      slot: z.string(),
                      rate_limit_rpm: z.number().nullable(),
                      rate_limit_tpm: z.number().nullable(),
                      rate_limit_rpd: z.number().nullable(),
                      rotation_policy: z.string(),
                      fallback_priority_global: z.number().nullable(),
                      health_status: z.string(),
                      disabled_at: z.string().nullable(),
                      created_at: z.string(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
    const project = c.get("project");
    const service = GatewayProviderCredentialService.create(prisma);
    const rows = await service.getAll(project.id);
    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        model_provider_id: row.modelProviderId,
        model_provider_name: row.modelProvider.provider,
        slot: row.slot,
        rate_limit_rpm: row.rateLimitRpm,
        rate_limit_tpm: row.rateLimitTpm,
        rate_limit_rpd: row.rateLimitRpd,
        rotation_policy: row.rotationPolicy.toLowerCase(),
        fallback_priority_global: row.fallbackPriorityGlobal,
        health_status: row.healthStatus.toLowerCase(),
        disabled_at: row.disabledAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      })),
    });
  })

  .post("/providers", async (c) => {
    const project = c.get("project");
    const raw = (await c.req.json()) as Record<string, unknown>;
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayProviderCredentialService.create(prisma);
    const row = await service.create({
      projectId: project.id,
      organizationId,
      modelProviderId: String(raw.model_provider_id ?? ""),
      slot: typeof raw.slot === "string" ? raw.slot : undefined,
      rateLimitRpm: (raw.rate_limit_rpm as number | null) ?? null,
      rateLimitTpm: (raw.rate_limit_tpm as number | null) ?? null,
      rateLimitRpd: (raw.rate_limit_rpd as number | null) ?? null,
      rotationPolicy:
        typeof raw.rotation_policy === "string"
          ? (raw.rotation_policy.toUpperCase() as
              | "AUTO"
              | "MANUAL"
              | "EXTERNAL_SECRET_STORE")
          : undefined,
      extraHeaders: (raw.extra_headers as Prisma.InputJsonValue | null) ?? null,
      providerConfig: (raw.provider_config as Prisma.InputJsonValue | null) ?? null,
      fallbackPriorityGlobal:
        (raw.fallback_priority_global as number | null) ?? null,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ provider_credential: { id: row.id } }, 201);
  })

  // ── Budgets ─────────────────────────────────────────────────────────────

  .get(
    "/budgets",
    describeRoute({
      summary: "List budgets applicable to the project",
      description:
        "Returns every budget that could apply to requests routed through this project — org, team, and project scope. VK and principal-scoped budgets are returned via their detail pages.",
      tags: ["Budgets"],
      responses: {
        ...baseResponses,
        200: {
          description: "Applicable budgets",
          content: {
            "application/json": {
              schema: resolver(z.object({ data: z.array(budgetDtoSchema) })),
            },
          },
        },
      },
    }),
    async (c) => {
    const project = c.get("project");
    const service = GatewayBudgetService.create(prisma);
    const rows = await service.listForProject(project.id);
    return c.json({
      data: rows.map((b) => ({
        id: b.id,
        organization_id: b.organizationId,
        scope_type: b.scopeType,
        scope_id: b.scopeId,
        name: b.name,
        description: b.description,
        window: b.window,
        on_breach: b.onBreach,
        limit_usd: b.limitUsd.toString(),
        spent_usd: b.spentUsd.toString(),
        resets_at: b.resetsAt.toISOString(),
        archived_at: b.archivedAt?.toISOString() ?? null,
      })),
    });
  })

  .post("/budgets", async (c) => {
    const project = c.get("project");
    const body = createBudgetSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { type: "bad_request", code: "validation_error", message: body.error.message } },
        400,
      );
    }
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayBudgetService.create(prisma);
    const row = await service.create({
      organizationId,
      scope: scopeFromWire(body.data.scope),
      name: body.data.name,
      description: body.data.description ?? null,
      window: body.data.window,
      limitUsd: body.data.limit_usd,
      onBreach: body.data.on_breach,
      timezone: body.data.timezone ?? null,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ budget: toBudgetDto(row) }, 201);
  })

  .patch("/budgets/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const raw = (await c.req.json()) as Record<string, unknown>;
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayBudgetService.create(prisma);
    const row = await service.update({
      id,
      organizationId,
      name: typeof raw.name === "string" ? raw.name : undefined,
      description:
        raw.description === undefined ? undefined : (raw.description as string | null),
      limitUsd:
        raw.limit_usd !== undefined ? (raw.limit_usd as number | string) : undefined,
      onBreach:
        raw.on_breach === "BLOCK" || raw.on_breach === "WARN"
          ? raw.on_breach
          : undefined,
      timezone:
        raw.timezone === undefined ? undefined : (raw.timezone as string | null),
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ budget: toBudgetDto(row) });
  })

  .delete("/budgets/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayBudgetService.create(prisma);
    const row = await service.archive({
      id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ budget: toBudgetDto(row) });
  })

  // ── Provider credentials — update + disable ────────────────────────────

  .patch("/providers/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const raw = (await c.req.json()) as Record<string, unknown>;
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayProviderCredentialService.create(prisma);
    const row = await service.update({
      id,
      projectId: project.id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
      slot: typeof raw.slot === "string" ? raw.slot : undefined,
      rateLimitRpm:
        raw.rate_limit_rpm === undefined
          ? undefined
          : (raw.rate_limit_rpm as number | null),
      rateLimitTpm:
        raw.rate_limit_tpm === undefined
          ? undefined
          : (raw.rate_limit_tpm as number | null),
      rateLimitRpd:
        raw.rate_limit_rpd === undefined
          ? undefined
          : (raw.rate_limit_rpd as number | null),
      rotationPolicy:
        typeof raw.rotation_policy === "string"
          ? (raw.rotation_policy.toUpperCase() as
              | "AUTO"
              | "MANUAL"
              | "EXTERNAL_SECRET_STORE")
          : undefined,
      extraHeaders:
        raw.extra_headers === undefined
          ? undefined
          : (raw.extra_headers as Prisma.InputJsonValue | null),
      providerConfig:
        raw.provider_config === undefined
          ? undefined
          : (raw.provider_config as Prisma.InputJsonValue | null),
      fallbackPriorityGlobal:
        raw.fallback_priority_global === undefined
          ? undefined
          : (raw.fallback_priority_global as number | null),
    });
    return c.json({ provider_credential: { id: row.id } });
  })

  .delete("/providers/:id", async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayProviderCredentialService.create(prisma);
    const row = await service.disable({
      id,
      projectId: project.id,
      organizationId,
      actorUserId: machineActorForProject(project.id),
    });
    return c.json({ provider_credential: { id: row.id, disabled_at: row.disabledAt?.toISOString() ?? null } });
  });

function toBudgetDto(b: import("@prisma/client").GatewayBudget) {
  return {
    id: b.id,
    organization_id: b.organizationId,
    scope_type: b.scopeType,
    scope_id: b.scopeId,
    name: b.name,
    description: b.description,
    window: b.window,
    on_breach: b.onBreach,
    limit_usd: b.limitUsd.toString(),
    spent_usd: b.spentUsd.toString(),
    timezone: b.timezone,
    current_period_started_at: b.currentPeriodStartedAt.toISOString(),
    resets_at: b.resetsAt.toISOString(),
    last_reset_at: b.lastResetAt?.toISOString() ?? null,
    archived_at: b.archivedAt?.toISOString() ?? null,
    created_at: b.createdAt.toISOString(),
  };
}

function scopeFromWire(
  scope: z.infer<typeof createBudgetSchema>["scope"],
): import("~/server/gateway/budget.service").BudgetScope {
  switch (scope.kind) {
    case "ORGANIZATION":
      return { kind: "ORGANIZATION", organizationId: scope.organization_id };
    case "TEAM":
      return { kind: "TEAM", teamId: scope.team_id };
    case "PROJECT":
      return { kind: "PROJECT", projectId: scope.project_id };
    case "VIRTUAL_KEY":
      return { kind: "VIRTUAL_KEY", virtualKeyId: scope.virtual_key_id };
    case "PRINCIPAL":
      return { kind: "PRINCIPAL", principalUserId: scope.principal_user_id };
  }
}

/**
 * Machine-principal actor id used for audit logs on writes from the REST API.
 * Uses the project id so audit entries can still be traced back to the
 * originating project API key. A future iteration may plumb the richer
 * ApiToken id through the auth middleware and switch to that identifier.
 */
function machineActorForProject(projectId: string): string {
  return `svc_${projectId}`;
}
