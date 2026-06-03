// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Platform-published default IngestionTemplate rows.
 *
 * v1 ships six real templates (claude_code / cursor / codex / gemini /
 * opencode / claude_cowork), each `organizationId IS NULL` so they
 * appear in every org's catalog. The /me Trace Ingest tile
 * `raw_otlp_advanced` is a client-side discovery card — it deep-links to the personal OTLP endpoint panel
 * and does NOT mint a UserIngestionBinding, so it intentionally has no
 * IngestionTemplate row (see Andre PM call at 348936e4f).
 *
 * `ottlRules` is empty for v1 — the receiver applies no OTTL transform
 * for otlp_token templates v1; canonical gen_ai shaping is done by the
 * upstream tool's exporter (Claude Code / Cursor / claude_cowork are all
 * already gen_ai-compliant). The OTTL slot is wired so v2 templates can
 * land per-template normalization without a service refactor.
 *
 * Spec:
 *   specs/ai-gateway/governance/ingestion-templates-catalog.feature
 *   specs/ai-gateway/governance/personal-project-ingest-via-template.feature
 */
import type { PrismaClient } from "@prisma/client";

export interface PlatformTemplateSeed {
  slug: string;
  sourceType: string;
  displayName: string;
  description: string;
  iconAsset: string | null;
  /** null = otlp_token-only (auto-issue, no input form). */
  credentialSchema: "static_api_key" | "agent_id" | null;
  ottlRules: string;
}

export const PLATFORM_INGESTION_TEMPLATES: readonly PlatformTemplateSeed[] = [
  {
    slug: "claude_code",
    sourceType: "claude_code",
    displayName: "Claude Code",
    description:
      "Connect Claude Code (Anthropic CLI) to LangWatch. Spans land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:claude_code",
    credentialSchema: null,
    ottlRules: "",
  },
  {
    slug: "cursor",
    sourceType: "cursor",
    displayName: "Cursor",
    description:
      "Connect Cursor's agent telemetry export. Spans land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:cursor",
    credentialSchema: null,
    ottlRules: "",
  },
  {
    slug: "codex",
    sourceType: "codex",
    displayName: "Codex",
    description:
      "Connect OpenAI Codex CLI to LangWatch. Spans land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:codex",
    credentialSchema: null,
    ottlRules: "",
  },
  {
    slug: "gemini",
    sourceType: "gemini",
    displayName: "Gemini",
    description:
      "Connect Google Gemini CLI to LangWatch. Spans land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:gemini",
    credentialSchema: null,
    ottlRules: "",
  },
  {
    slug: "opencode",
    sourceType: "opencode",
    displayName: "opencode",
    description:
      "Connect opencode (open-source terminal coding agent) telemetry. Spans emitted via OTEL_*_EXPORTER land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:opencode",
    credentialSchema: null,
    ottlRules: "",
  },
  {
    slug: "claude_cowork",
    sourceType: "claude_cowork",
    displayName: "Claude cowork",
    description:
      "Connect Claude cowork session telemetry. Spans land at /me/traces with gen_ai.usage.* + cost.usd populated automatically by the receiver.",
    iconAsset: "preset:claude_cowork",
    credentialSchema: null,
    ottlRules: "",
  },
] as const;

/**
 * Slugs that previously had platform rows (e.g. during contract debate)
 * but are now intentionally NOT IngestionTemplate rows. The seeder
 * archives any DB rows matching these slugs so dev environments converge
 * to the locked v1 catalog when the constant evolves.
 */
const RETIRED_PLATFORM_TEMPLATE_SLUGS: readonly string[] = [
  // raw_otlp_advanced is a client-side discovery card — deep-links to
  // the personal OTLP endpoint panel; never an IngestionTemplate row
  // per Andre PM call at 348936e4f. Cleanup any stale rows from earlier
  // seed runs.
  "raw_otlp_advanced",
];

/**
 * Idempotent: upserts each platform-default row keyed on
 * `(organizationId IS NULL, slug)`. Safe to run multiple times — re-runs
 * sync the displayName / description / iconAsset / ottlRules to whatever
 * is currently in the constant (intentionally — platform-team edits to
 * the seed file flow to dev DBs on the next seed run).
 *
 * Returns the count of rows that were created vs updated for ops
 * visibility.
 */
export async function seedPlatformIngestionTemplates(
  prisma: PrismaClient,
): Promise<{ created: number; updated: number; archived: number }> {
  let created = 0;
  let updated = 0;
  let archived = 0;

  for (const tmpl of PLATFORM_INGESTION_TEMPLATES) {
    // We can't use prisma.upsert with the (organizationId, slug) compound
    // unique key when organizationId is NULL, because Postgres treats
    // NULL as not-equal-to-NULL in unique constraints. Look up + branch
    // explicitly instead.
    const existing = await prisma.ingestionTemplate.findFirst({
      where: { organizationId: null, slug: tmpl.slug },
      select: { id: true },
    });
    if (existing) {
      await prisma.ingestionTemplate.update({
        where: { id: existing.id },
        data: {
          sourceType: tmpl.sourceType,
          displayName: tmpl.displayName,
          description: tmpl.description,
          iconAsset: tmpl.iconAsset,
          credentialSchema: tmpl.credentialSchema,
          ottlRules: tmpl.ottlRules,
          platformPublished: true,
          enabled: true,
          archivedAt: null,
        },
      });
      updated++;
    } else {
      await prisma.ingestionTemplate.create({
        data: {
          organizationId: null,
          slug: tmpl.slug,
          sourceType: tmpl.sourceType,
          displayName: tmpl.displayName,
          description: tmpl.description,
          iconAsset: tmpl.iconAsset,
          credentialSchema: tmpl.credentialSchema,
          ottlRules: tmpl.ottlRules,
          platformPublished: true,
          enabled: true,
        },
      });
      created++;
    }
  }

  // Archive retired slugs (idempotent — already-archived rows stay
  // archived; missing rows skip cleanly).
  for (const slug of RETIRED_PLATFORM_TEMPLATE_SLUGS) {
    const stale = await prisma.ingestionTemplate.findFirst({
      where: { organizationId: null, slug, archivedAt: null },
      select: { id: true },
    });
    if (stale) {
      await prisma.ingestionTemplate.update({
        where: { id: stale.id },
        data: { archivedAt: new Date(), enabled: false },
      });
      archived++;
    }
  }

  return { created, updated, archived };
}
