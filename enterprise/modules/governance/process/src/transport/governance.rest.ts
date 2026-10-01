// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/governance`, the ingestion templates as a project key reaches them.
 * Every verb dispatches through the same application the tRPC doors call.
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import {
  baseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  governanceRestCloneTemplateSchema,
  governanceRestCreateTemplateSchema,
  governanceRestTemplateArchivedSchema,
  governanceRestTemplateDetailSchema,
  governanceRestTemplateListSchema,
  governanceRestTemplateParamsSchema,
  governanceRestUpdateOttlRulesSchema,
  type GovernanceProjectCaller,
  GovernanceRestApi,
  type IngestionTemplateDto,
  UserBoundCallerRequiredError,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:api:governance");

/**
 * The member behind the project credential, or nothing for a legacy project
 * token. The org template administration routes refuse the latter.
 */
export const governanceRestCaller = defineRestMiddleware(
  "governanceRestCaller",
  z.object({ viewerUserId: z.string().nullable() }),
);

/**
 * Which surface initiated the call, for the audit row. Only `cli` is honoured;
 * anything else reads as the route mount, so the wire cannot claim to be an
 * in-process surface (`trpc` / `mcp`).
 */
export const governanceRestSurface = defineRestMiddleware(
  "governanceRestSurface",
  z
    .string()
    .nullable()
    .transform((declared): "hono" | "cli" => (declared?.toLowerCase() === "cli" ? "cli" : "hono")),
);

type CallerFacts = z.output<typeof governanceRestCaller.schema>;
type SurfaceFacts = z.output<typeof governanceRestSurface.schema>;

/** One template row on the wire this family has always published. */
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
}): IngestionTemplateDto {
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
 * Org template administration must be driven by a real person: a legacy
 * project token bypasses the `aiTools:manage` ceiling, so without this its
 * holder could read every org template's OTTL and mutate org config.
 */
function boundMemberId(facts: CallerFacts): string {
  if (facts.viewerUserId === null) throw new UserBoundCallerRequiredError();

  return facts.viewerUserId;
}

/** Who a write is attributed to. A key acting as nobody is refused upstream. */
function callerOf(input: {
  projectId: string;
  facts: CallerFacts;
  surface: SurfaceFacts;
}): GovernanceProjectCaller {
  return {
    projectId: input.projectId,
    userId: boundMemberId(input.facts),
    surface: input.surface,
  };
}

export const governanceRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/ingestion-templates", "listIngestionTemplates")
  .withPermission("aiTools:view")
  .withOutput(governanceRestTemplateListSchema)
  .withDocs({
    summary: "List ingestion templates",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Returns the union of platform-published default templates and any org-authored templates visible to the caller's organization. Disabled / archived rows are filtered out. `ottl_rules` is empty in this end-user shape; admins use GET /ingestion-templates/admin to read the canonical OTTL.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, scope }) => {
    const rows = await app.listIngestionTemplatesForMember({ projectId: scope.id });

    return { data: rows.map(toTemplateDto) };
  })

  .get("/ingestion-templates/admin", "listIngestionTemplatesForAdmin")
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateListSchema)
  .withMiddleware(governanceRestCaller)
  .withDocs({
    summary: "List ingestion templates (admin shape, includes OTTL)",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Same union as the user list but includes the canonical `ottl_rules` source for every row. Used by admin tooling to render the transparency block / authoring drawer.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, scope }, facts) => {
    boundMemberId(facts);
    const rows = await app.listIngestionTemplatesForAdmin({ projectId: scope.id });

    return { data: rows.map(toTemplateDto) };
  })

  /**
   * Carries the canonical `ottl_rules` — what the member list blanks — so one
   * row at a time is gated exactly as the admin list is.
   */
  .get("/ingestion-templates/:ingestionTemplateId", "getIngestionTemplate")
  .withParams(governanceRestTemplateParamsSchema)
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateDetailSchema)
  .withMiddleware(governanceRestCaller)
  .withDocs({
    summary: "Get ingestion template",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Single-template lookup by id, scoped to the caller's organization, including the canonical `ottl_rules`. Cross-org probes collapse to 404 (no enumeration vector). Members read the same row without `ottl_rules` from GET /ingestion-templates.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }, facts) => {
    boundMemberId(facts);

    return {
      ingestion_template: toTemplateDto(
        await app.getIngestionTemplate({ projectId: scope.id, id: input.ingestionTemplateId }),
      ),
    };
  })

  .post("/ingestion-templates", "createIngestionTemplate")
  .withInput(governanceRestCreateTemplateSchema)
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateDetailSchema)
  .withStatus(201)
  .withMiddleware(governanceRestCaller, governanceRestSurface)
  .withDocs({
    summary: "Create org-authored ingestion template",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Creates a brand-new template scoped to the caller's organization. Slug is auto-generated. Platform rows (organizationId IS NULL) are NEVER created via this endpoint — admins customize platform defaults via POST /ingestion-templates/clone instead.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }, facts, surface) => {
    const by = callerOf({ projectId: scope.id, facts, surface });
    const row = await app.createIngestionTemplate(
      {
        sourceType: input.source_type,
        displayName: input.display_name,
        description: input.description ?? null,
        iconAsset: input.icon_asset ?? null,
        credentialSchema:
          input.credential_schema === "otlp_token" ? null : (input.credential_schema ?? null),
        ottlRules: input.ottl_rules,
      },
      by,
    );

    logger.info(
      { templateId: row.id, projectId: by.projectId, apiKeyUserId: by.userId },
      "ingestion template created via REST",
    );

    return { ingestion_template: toTemplateDto(row) };
  })

  .patch("/ingestion-templates/:ingestionTemplateId/ottl-rules", "updateIngestionTemplateOttlRules")
  .withParams(governanceRestTemplateParamsSchema)
  .withInput(governanceRestUpdateOttlRulesSchema)
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateDetailSchema)
  .withMiddleware(governanceRestCaller, governanceRestSurface)
  .withDocs({
    summary: "Replace ottl_rules on an org-authored template",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Audit-logged with line counts pre/post. Platform-published rows reject with 403. Admins must clone a platform row before editing it.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }, facts, surface) => {
    const row = await app.updateIngestionTemplateOttlRules(
      { id: input.ingestionTemplateId, ottlRules: input.ottl_rules },
      callerOf({ projectId: scope.id, facts, surface }),
    );

    return { ingestion_template: toTemplateDto(row) };
  })

  .delete("/ingestion-templates/:ingestionTemplateId", "archiveIngestionTemplate")
  .withParams(governanceRestTemplateParamsSchema)
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateArchivedSchema)
  .withMiddleware(governanceRestCaller, governanceRestSurface)
  .withDocs({
    summary: "Soft-archive an org-authored template",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Marks the row archived; existing ingestion keys continue to land traces but the row disappears from list views. Platform-published rows reject with 403.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }, facts, surface) => {
    await app.archiveIngestionTemplate(
      { id: input.ingestionTemplateId },
      callerOf({ projectId: scope.id, facts, surface }),
    );

    return { archived: true as const };
  })

  .post("/ingestion-templates/clone", "cloneIngestionTemplate")
  .withInput(governanceRestCloneTemplateSchema)
  .withPermission("aiTools:manage")
  .withOutput(governanceRestTemplateDetailSchema)
  .withStatus(201)
  .withMiddleware(governanceRestCaller, governanceRestSurface)
  .withDocs({
    summary: "Clone a platform-published template into the caller's org",
    tags: ["Governance / Ingestion Templates"],
    description:
      "Forks the source row's source_type / display_name / OTTL into a fresh org-authored row that the admin can then edit via PATCH /ingestion-templates/:id/ottl-rules.",
    responses: { ...baseResponses },
  })
  .handle(async ({ app, input, scope }, facts, surface) => {
    const row = await app.cloneIngestionTemplate(
      { sourceTemplateId: input.source_template_id },
      callerOf({ projectId: scope.id, facts, surface }),
    );

    return { ingestion_template: toTemplateDto(row) };
  })

  .build();
