// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ensureHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import { armIngestionPullForSource } from "@ee/governance/services/pullers/ingestionPullScheduler";
import type { IngestionSource, Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
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
import { env } from "~/env.mjs";
import { isEnterpriseTier } from "~/server/api/enterprise";
import { getApp } from "~/server/app-layer/app";
import { encryptParserConfigCredentials } from "./ingestionCredentials";
import { NON_ENTERPRISE_INGESTION_SOURCE_CAP } from "./ingestionSource.constants";

export type SourceType =
  | "otel_generic"
  | "claude_code"
  | "claude_cowork"
  | "workato"
  | "copilot_studio"
  | "openai_compliance"
  | "claude_compliance"
  | "s3_custom"
  | "http_custom";

export const SUPPORTED_SOURCE_TYPES: readonly SourceType[] = [
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  "copilot_studio",
  "openai_compliance",
  "claude_compliance",
  "s3_custom",
  "http_custom",
] as const;

export interface CreateIngestionSourceInput {
  organizationId: string;
  teamId?: string | null;
  sourceType: SourceType;
  name: string;
  description?: string | null;
  parserConfig?: Record<string, unknown>;
  /**
   * Phase 10: opaque adapter config persisted on IngestionSource.pullConfig.
   * Worker resolves `pullConfig.adapter` through the pullerAdapterRegistry
   * and dispatches `runOnce`. For reference adapters (copilot_studio etc.)
   * the URL/auth/mapping are locked and the admin-supplied portion is just
   * the adapter id + credentials reference.
   */
  pullConfig?: Record<string, unknown> | null;
  /** Cron schedule string, fired by the event-sourcing puller scheduler
   *  (parsed in-process, not Linux cron). Null = use adapter default. */
  pullSchedule?: string | null;
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
  async findByIngestSecret(rawSecret: string): Promise<IngestionSource | null> {
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
        parserConfig: {
          path: ["_rotation", "priorHash"],
          equals: candidateHash,
        },
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
    // Defense-in-depth plan gate. Non-enterprise orgs can create up to
    // NON_ENTERPRISE_INGESTION_SOURCE_CAP active sources (composer
    // separately restricts source TYPE to otel_generic for them). This
    // catches non-tRPC callers (background workers, webhook adapters)
    // so the cap can't be bypassed regardless of entry point. Enterprise
    // orgs are unbounded. Spec: specs/ai-gateway/license-gate-governance.feature.
    const plan = await getApp().planProvider.getActivePlan({
      organizationId: input.organizationId,
    });
    if (!isEnterpriseTier(plan.type)) {
      const existing = await this.prisma.ingestionSource.count({
        where: { organizationId: input.organizationId, archivedAt: null },
      });
      if (existing >= NON_ENTERPRISE_INGESTION_SOURCE_CAP) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Non-enterprise plans are limited to ${NON_ENTERPRISE_INGESTION_SOURCE_CAP} ingestion sources. Upgrade to Enterprise for unlimited.`,
        });
      }
    }

    if (!SUPPORTED_SOURCE_TYPES.includes(input.sourceType)) {
      throw new Error(`Unsupported sourceType: ${input.sourceType}`);
    }

    // Lazy-ensure the hidden Governance Project on first source mint —
    // every IngestionSource for an org routes its events through this
    // single internal Project. Idempotent. Single helper, no duplicate
    // lazy-create logic anywhere else (master_orchestrator constraint).
    await ensureHiddenGovernanceProject(this.prisma, input.organizationId);

    const ingestSecret = generateIngestSecret();
    const ingestSecretHash = hashIngestSecret(ingestSecret);

    // Phase 10 carryover — the schema has `parserConfig` but no
    // `pullConfig` column; the puller worker actually reads
    // `source.parserConfig` as the adapter config (see
    // pullerWorker.ts:89 `const pullConfig = source.parserConfig`).
    // The earlier service shape exposed both inputs as if they were
    // separate columns, which 500'd at create time (Ariana caught
    // this on the OTLP-ingestion-source dogfood). Merge here so
    // callers can keep using either field name without a schema
    // change. `parserConfig` wins on key conflicts (it's the
    // canonical input for push-mode sources); `pullConfig` data
    // fills in for pull-mode adapters.
    const mergedParserConfig = encryptParserConfigCredentials({
      ...(input.pullConfig ?? {}),
      ...(input.parserConfig ?? {}),
    })!;
    const source = await this.prisma.ingestionSource.create({
      data: {
        organizationId: input.organizationId,
        teamId: input.teamId ?? null,
        sourceType: input.sourceType,
        name: input.name,
        description: input.description ?? null,
        ingestSecretHash,
        parserConfig: mergedParserConfig as Prisma.InputJsonValue,
        pullSchedule: input.pullSchedule ?? null,
        status: "awaiting_first_event",
        createdById: input.actorUserId,
      },
    });

    // A schedule on a new pull-mode source starts immediately, without waiting
    // for a worker restart to re-seed it (event-sourcing pull scheduler).
    await armIngestionPullForSource({
      id: source.id,
      pullSchedule: source.pullSchedule,
      organizationId: source.organizationId,
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
      data.parserConfig = encryptParserConfigCredentials(
        input.parserConfig,
      ) as Prisma.InputJsonValue;
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
      throw new Error(
        `IngestionSource ${id} not found in org ${organizationId}`,
      );
    }
    const newSecret = generateIngestSecret();
    const newHash = hashIngestSecret(newSecret);
    const priorParser =
      (existing.parserConfig as Record<string, unknown>) ?? {};
    const merged = encryptParserConfigCredentials({
      ...priorParser,
      _rotation: {
        priorHash: existing.ingestSecretHash,
        expiresAt: Date.now() + ROTATION_GRACE_MS,
      },
    })!;
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
      throw new Error(
        `IngestionSource ${id} not found in org ${organizationId}`,
      );
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
