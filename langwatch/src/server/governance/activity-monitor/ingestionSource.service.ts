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
import { ensureHiddenGovernanceProject } from "~/server/governance/governanceProject.service";

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

/** Canonical retention bucket values. Free-form string in the DB column
 *  for extensibility (matching IngestionSource.sourceType pattern); this
 *  constant is the source of truth in TS. CH TTL policy reads the value
 *  from `langwatch.governance.retention_class` at delete-time. */
export const RETENTION_CLASSES = {
  THIRTY_DAYS: "thirty_days",
  ONE_YEAR: "one_year",
  SEVEN_YEARS: "seven_years",
} as const;
export type RetentionClass =
  (typeof RETENTION_CLASSES)[keyof typeof RETENTION_CLASSES];

export const SUPPORTED_RETENTION_CLASSES: readonly RetentionClass[] = [
  "thirty_days",
  "one_year",
  "seven_years",
] as const;

export interface CreateIngestionSourceInput {
  organizationId: string;
  teamId?: string | null;
  sourceType: SourceType;
  name: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  retentionClass?: RetentionClass;
  actorUserId: string;
}

export interface UpdateIngestionSourceInput {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  retentionClass?: RetentionClass;
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
    // Rotation grace path: scan only sources where parserConfig has a
    // `_rotation` slot (Prisma JSON `path` filter). We avoid $queryRaw
    // because dbMultiTenancyProtection rejects raw queries (no model
    // context to authorise against). For typical orgs the rotating
    // set is tiny (hours-scale grace window) so the in-app hash check
    // on each is negligible.
    const candidates = await this.prisma.ingestionSource.findMany({
      where: {
        archivedAt: null,
        parserConfig: { path: ["_rotation", "priorHash"], equals: candidateHash },
      },
    });
    const now = Date.now();
    for (const candidate of candidates) {
      const rotation =
        ((candidate.parserConfig as Record<string, unknown>)?._rotation as
          | { priorHash?: string; expiresAt?: number }
          | undefined) ?? undefined;
      if (
        rotation?.priorHash === candidateHash &&
        typeof rotation.expiresAt === "number" &&
        rotation.expiresAt > now
      ) {
        return candidate;
      }
    }
    return null;
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
    const retentionClass = input.retentionClass ?? "thirty_days";
    if (!SUPPORTED_RETENTION_CLASSES.includes(retentionClass)) {
      throw new Error(`Unsupported retentionClass: ${retentionClass}`);
    }

    // Lazy-ensure the hidden Governance Project on first source mint —
    // every IngestionSource for an org routes its events through this
    // single internal Project. Idempotent. Single helper, no duplicate
    // lazy-create logic anywhere else (master_orchestrator constraint).
    await ensureHiddenGovernanceProject(this.prisma, input.organizationId);

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
        retentionClass,
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
    if (input.retentionClass !== undefined) {
      if (!SUPPORTED_RETENTION_CLASSES.includes(input.retentionClass)) {
        throw new Error(
          `Unsupported retentionClass: ${input.retentionClass}`,
        );
      }
      data.retentionClass = input.retentionClass;
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
