// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@prisma/client";

import { ApiKeyService } from "~/server/api-key/api-key.service";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";

import { PersonalWorkspaceService } from "./personalWorkspace.service";

/**
 * Issues and rotates "ingestion keys": project-scoped, ingest-only ApiKeys.
 *
 * An ingestion key is one row of the single ApiKey primitive (`sk-lw-`,
 * HMAC+pepper) with:
 *   - `ingestSourceType` set to the tool slug (claude_code / codex / gemini /
 *     opencode / claude_cowork) — stamped as `langwatch.source` provenance.
 *   - a single PROJECT-scoped CUSTOM role binding granting only `traces:create`
 *     (genuinely write-only — see ingest-api-key-lifecycle.feature).
 *   - `userId = null`: it is a project credential, not a user credential, so it
 *     behaves identically for personal and team projects. Authorization to mint
 *     is enforced by the caller (router).
 *
 * Rotation is hard-cut: minting revokes any prior live ingest key for the same
 * (project, sourceType) before creating the new one, so a tool never
 * accumulates keys.
 */
export class IngestionKeyService {
  private readonly apiKeys: ApiKeyService;
  private readonly apiKeyRepo: ApiKeyRepository;
  private readonly personalWorkspace: PersonalWorkspaceService;

  constructor(private readonly prisma: PrismaClient) {
    this.apiKeys = ApiKeyService.create(prisma);
    this.apiKeyRepo = ApiKeyRepository.create(prisma);
    this.personalWorkspace = new PersonalWorkspaceService(prisma);
  }

  static create(prisma: PrismaClient): IngestionKeyService {
    return new IngestionKeyService(prisma);
  }

  /**
   * Issues (rotating in place) an ingestion key for a specific project.
   * Returns the plaintext token exactly once.
   */
  async ensureForProject({
    callerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId = null,
  }: {
    callerUserId: string;
    organizationId: string;
    projectId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
  }): Promise<{ token: string; apiKeyId: string; prefix: string; sourceType: string }> {
    // Hard-cut rotation: revoke any prior live ingest key for this
    // (project, sourceType) so the previous token dies immediately and we
    // never accumulate keys.
    const prior = await this.apiKeyRepo.findIngestKey({ projectId, sourceType });
    if (prior) {
      await this.apiKeys.revoke({
        id: prior.id,
        callerUserId,
        callerIsAdmin: true,
        organizationId,
      });
    }

    const { token, apiKey } = await this.apiKeys.create({
      name: `Ingestion key (${sourceType})`,
      // Project credential, not user-owned — authz is enforced at the router.
      userId: null,
      createdByUserId: callerUserId,
      organizationId,
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      ingestSourceType: sourceType,
      ingestionTemplateId,
    });

    return {
      token,
      apiKeyId: apiKey.id,
      prefix: token.slice(0, 12),
      sourceType,
    };
  }

  /**
   * Issues an ingestion key for the caller's personal project in the given org.
   * Used by the unified CLI Path B (no template) and by personal template
   * installs (with a templateId).
   */
  async ensureForPersonalProject({
    userId,
    organizationId,
    sourceType,
    ingestionTemplateId = null,
  }: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
  }): Promise<{ token: string; apiKeyId: string; prefix: string; sourceType: string }> {
    const workspace = await this.personalWorkspace.findExisting({
      userId,
      organizationId,
    });
    if (!workspace) {
      throw new Error(
        "No personal project for caller. Sign in to a personal workspace before issuing an ingestion key.",
      );
    }

    return this.ensureForProject({
      callerUserId: userId,
      organizationId,
      projectId: workspace.project.id,
      sourceType,
      ingestionTemplateId,
    });
  }

  /**
   * Lists the live ingestion keys in the caller's personal project for the
   * given org. Returns one row per connected source (sourceType +
   * ingestionTemplateId), so the /me Trace Ingest grid can render
   * green-checked tiles that survive a reload. The plaintext token is never
   * returned here — only mint/rotate reveal it once.
   */
  async listForPersonalProject({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<
    {
      apiKeyId: string;
      sourceType: string;
      ingestionTemplateId: string | null;
    }[]
  > {
    const workspace = await this.personalWorkspace.findExisting({
      userId,
      organizationId,
    });
    if (!workspace) return [];

    const keys = await this.apiKeyRepo.findIngestKeysForProject({
      projectId: workspace.project.id,
    });
    return keys
      .filter((k): k is typeof k & { ingestSourceType: string } =>
        Boolean(k.ingestSourceType),
      )
      .map((k) => ({
        apiKeyId: k.id,
        sourceType: k.ingestSourceType,
        ingestionTemplateId: k.ingestionTemplateId,
      }));
  }
}
