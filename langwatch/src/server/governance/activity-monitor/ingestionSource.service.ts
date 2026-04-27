/**
 * IngestionSourceService — admin CRUD for the per-platform fleet
 * configuration that powers the Activity Monitor pillar (cf.
 * specs/ai-gateway/governance/ingestion-sources.feature,
 * docs/ai-gateway/governance/architecture.md).
 *
 * Org-scoped (no projectId). Optional teamId narrows scope. Auth is
 * enforced at the tRPC / Hono route layer via
 * `checkOrganizationPermission("organization:manage")`. This service
 * does NOT re-check permissions — it trusts the caller resolved them.
 *
 * Secret handling: ingestSecret is auto-generated on create (32 random
 * bytes, base64url) and returned to the caller exactly once. We
 * persist only `ingestSecretHash` (sha256-with-pepper-prefix) so a
 * DB leak doesn't expose live tokens. Rotation mints a new secret +
 * keeps the old hash valid for a 24h grace window via the parserConfig
 * `_rotation` slot — the receiver layer accepts either during the
 * window.
 */
import { createHash, randomBytes } from "crypto";

import type { IngestionSource, Prisma, PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";

export type SourceType =
  | "otel_generic"
  | "claude_cowork"
  | "workato"
  | "copilot_studio"
  | "openai_compliance"
  | "claude_compliance"
  | "s3_custom";

export const SUPPORTED_SOURCE_TYPES: readonly SourceType[] = [
  "otel_generic",
  "claude_cowork",
  "workato",
  "copilot_studio",
  "openai_compliance",
  "claude_compliance",
  "s3_custom",
] as const;

export interface CreateIngestionSourceInput {
  organizationId: string;
  teamId?: string | null;
  sourceType: SourceType;
  name: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  actorUserId: string;
}

export interface UpdateIngestionSourceInput {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  status?: "active" | "disabled" | "awaiting_first_event";
  teamId?: string | null;
}

export interface CreatedIngestionSource {
  source: IngestionSource;
  /** Raw ingestSecret — exposed exactly once at creation and never persisted. */
  ingestSecret: string;
}

const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export class IngestionSourceService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): IngestionSourceService {
    return new IngestionSourceService(prisma);
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async list(organizationId: string): Promise<IngestionSource[]> {
    return this.prisma.ingestionSource.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ name: "asc" }],
    });
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<IngestionSource | null> {
    const row = await this.prisma.ingestionSource.findUnique({ where: { id } });
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  /**
   * Resolve a raw ingestSecret to its IngestionSource row. Used by the
   * push-mode receivers (/api/ingest/otel, /api/ingest/webhook) at the
   * top of every request. Returns null on miss — receivers should
   * respond 401.
   *
   * Honours the rotation grace window: if `parserConfig._rotation`
   * carries the prior hash with `expiresAt > now`, both hashes match
   * the same source.
   */
  async findByIngestSecret(
    rawSecret: string,
  ): Promise<IngestionSource | null> {
    const candidateHash = hashIngestSecret(rawSecret);
    const direct = await this.prisma.ingestionSource.findFirst({
      where: { ingestSecretHash: candidateHash, archivedAt: null },
    });
    if (direct) return direct;
    // Rotation grace path: scan for sources with a still-valid prior
    // hash. Cheap because we only look at sources that actually rotated
    // recently (filterable via `parserConfig::jsonb -> '_rotation' IS NOT NULL`).
    const rotating = await this.prisma.$queryRaw<IngestionSource[]>`
      SELECT * FROM "IngestionSource"
       WHERE "archivedAt" IS NULL
         AND "parserConfig" -> '_rotation' IS NOT NULL
         AND "parserConfig" -> '_rotation' ->> 'priorHash' = ${candidateHash}
         AND ("parserConfig" -> '_rotation' ->> 'expiresAt')::bigint > ${Date.now()}
       LIMIT 1
    `;
    return rotating[0] ?? null;
  }

  // ---------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------

  async createSource(
    input: CreateIngestionSourceInput,
  ): Promise<CreatedIngestionSource> {
    if (!SUPPORTED_SOURCE_TYPES.includes(input.sourceType)) {
      throw new Error(`Unsupported sourceType: ${input.sourceType}`);
    }
    const ingestSecret = generateIngestSecret();
    const ingestSecretHash = hashIngestSecret(ingestSecret);
    const source = await this.prisma.ingestionSource.create({
      data: {
        organizationId: input.organizationId,
        teamId: input.teamId ?? null,
        sourceType: input.sourceType,
        name: input.name,
        description: input.description ?? null,
        ingestSecretHash,
        parserConfig: (input.parserConfig ?? {}) as Prisma.InputJsonValue,
        status: "awaiting_first_event",
        createdById: input.actorUserId,
      },
    });
    return { source, ingestSecret };
  }

  async updateSource(
    input: UpdateIngestionSourceInput,
  ): Promise<IngestionSource> {
    const existing = await this.findById(input.id, input.organizationId);
    if (!existing) {
      throw new Error(
        `IngestionSource ${input.id} not found in org ${input.organizationId}`,
      );
    }
    const data: Prisma.IngestionSourceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.parserConfig !== undefined) {
      data.parserConfig = input.parserConfig as Prisma.InputJsonValue;
    }
    if (input.status !== undefined) data.status = input.status;
    if (input.teamId !== undefined) {
      data.team = input.teamId
        ? { connect: { id: input.teamId } }
        : { disconnect: true };
    }
    return this.prisma.ingestionSource.update({
      where: { id: existing.id },
      data,
    });
  }

  /**
   * Rotate the ingestSecret with a 24h grace window. The new secret is
   * returned exactly once; the old hash stays valid until grace expires
   * so the upstream operator has time to paste in the new value.
   */
  async rotateSecret(
    id: string,
    organizationId: string,
  ): Promise<{ source: IngestionSource; ingestSecret: string }> {
    const existing = await this.findById(id, organizationId);
    if (!existing) {
      throw new Error(`IngestionSource ${id} not found in org ${organizationId}`);
    }
    const newSecret = generateIngestSecret();
    const newHash = hashIngestSecret(newSecret);
    const priorParser = (existing.parserConfig as Record<string, unknown>) ?? {};
    const merged = {
      ...priorParser,
      _rotation: {
        priorHash: existing.ingestSecretHash,
        expiresAt: Date.now() + ROTATION_GRACE_MS,
      },
    };
    const source = await this.prisma.ingestionSource.update({
      where: { id: existing.id },
      data: {
        ingestSecretHash: newHash,
        parserConfig: merged as Prisma.InputJsonValue,
      },
    });
    return { source, ingestSecret: newSecret };
  }

  async archive(id: string, organizationId: string): Promise<IngestionSource> {
    const existing = await this.findById(id, organizationId);
    if (!existing) {
      throw new Error(`IngestionSource ${id} not found in org ${organizationId}`);
    }
    return this.prisma.ingestionSource.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: "disabled" },
    });
  }

  /**
   * Stamp lastEventAt + flip status to 'active' on the first event
   * received from a source. Called by every receiver (push + pull) at
   * the top of every successful event handle.
   */
  async recordEventReceived(id: string): Promise<void> {
    await this.prisma.ingestionSource.update({
      where: { id },
      data: {
        lastEventAt: new Date(),
        status: "active",
      },
    });
  }
}

// ---------------------------------------------------------------------
// Secret helpers (also exported for the receiver layer)
// ---------------------------------------------------------------------

export function generateIngestSecret(): string {
  return `lw_is_${randomBytes(32).toString("base64url")}`;
}

export function hashIngestSecret(rawSecret: string): string {
  // Pepper-prefix prevents rainbow-table style attacks on the hash
  // column. Reuses the same per-deployment pepper as VirtualKey
  // hashing (LW_VIRTUAL_KEY_PEPPER) so secret-rotation across all
  // governance secrets is a single env var bump.
  const pepper = env.LW_VIRTUAL_KEY_PEPPER ?? "";
  return createHash("sha256")
    .update(`${pepper}::${rawSecret}`)
    .digest("base64url");
}
