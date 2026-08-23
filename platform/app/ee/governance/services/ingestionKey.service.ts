// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "~/generated/prisma/client";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { ApiKeyService } from "~/server/api-key/api-key.service";

import { PersonalWorkspaceService } from "./personalWorkspace.service";

/** What every project-scoped mint needs to know. */
interface IngestionKeyMintParams {
  callerUserId: string;
  ownerUserId: string | null;
  organizationId: string;
  projectId: string;
  sourceType: string;
  ingestionTemplateId?: string | null;
  /**
   * Human label of the CLI device session that minted the key (display
   * provenance on the API-keys settings page). Null for non-CLI callers.
   */
  createdByDeviceLabel?: string | null;
}

/**
 * The caller has no personal workspace yet, so there is no project for a
 * personal key to reach. Named so a caller can answer "finish your workspace
 * setup" for this one cause and keep every other failure a real error.
 */
export class PersonalWorkspaceMissingError extends Error {
  constructor() {
    super(
      "No personal project for caller. Sign in to a personal workspace before issuing an ingestion key.",
    );
    this.name = "PersonalWorkspaceMissingError";
  }
}

/** The plaintext token, returned exactly once, plus its identifiers. */
export interface IssuedIngestionKey {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
}

/**
 * Issues and rotates "ingestion keys": project-scoped, ingest-only ApiKeys.
 *
 * An ingestion key is one row of the single ApiKey primitive (`ik-lw-` prefix,
 * HMAC+pepper) with:
 *   - `ingestSourceType` set to the tool slug (claude_code / codex / gemini /
 *     opencode / claude_cowork) — stamped as `langwatch.source` provenance.
 *   - a single PROJECT-scoped CUSTOM role binding granting only `traces:create`
 *     (genuinely write-only — see ingest-api-key-lifecycle.feature).
 *   - `userId` = the owning user for personal-project keys (so the API-key list
 *     scopes them to their owner), or `null` for an org service key. Authorization
 *     to mint is enforced by the caller (router); ownership only governs list
 *     visibility.
 *
 * Two mint shapes, picked by the caller:
 *   - `ensureForProject` rotates hard-cut: it revokes any prior live ingest key
 *     for the same (project, sourceType) before creating the new one, so a
 *     single owner of a source never accumulates keys.
 *   - `issueForProject` only creates. Several machines can each hold their own
 *     live key for one (project, sourceType) pair, and revoking one machine's
 *     key leaves the others working.
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
   *
   * `ownerUserId` decides API-key list visibility: pass the owning user for a
   * personal-project key (so only that user and org admins see it), or `null`
   * for a company-wide governance-project key (a genuine org service key).
   */
  async ensureForProject({
    callerUserId,
    ownerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId = null,
    createdByDeviceLabel = null,
  }: IngestionKeyMintParams): Promise<IssuedIngestionKey> {
    // Hard-cut rotation: revoke any prior live ingest key for this
    // (project, sourceType) so the previous token dies immediately and we
    // never accumulate keys.
    const prior = await this.apiKeyRepo.findIngestKey({
      organizationId,
      projectId,
      sourceType,
    });
    if (prior) {
      await this.apiKeys.revoke({
        id: prior.id,
        callerUserId,
        callerIsAdmin: true,
        organizationId,
        // The prior key is dead the moment its row is revoked, and its
        // private role is named after that key id, so the mint below never
        // waits for the name. Holding here for the role deletion to project
        // only added a fold pickup cycle to a rotation that already waits
        // for the new key's own writes: the CLI's first `langwatch claude`
        // after a logout sat well over twenty seconds on this one request.
        awaitProjection: false,
      });
    }

    return await this.mint({
      name: `Ingestion key (${sourceType})`,
      callerUserId,
      ownerUserId,
      organizationId,
      projectId,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
    });
  }

  /**
   * Issues an ingestion key for a specific project WITHOUT touching the keys
   * that already exist for that (project, sourceType). Returns the plaintext
   * token exactly once.
   *
   * This is what a per-machine mint needs: two laptops working on the same
   * repository each hold their own token, so one developer re-running the
   * setup does not silently kill the other's telemetry. The key name carries
   * the source type and the minting device, so the API-keys settings page
   * shows where each row came from.
   *
   * `ownerUserId` decides API-key list visibility, exactly as in
   * `ensureForProject`.
   */
  async issueForProject({
    callerUserId,
    ownerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId = null,
    createdByDeviceLabel = null,
  }: IngestionKeyMintParams): Promise<IssuedIngestionKey> {
    const origin = createdByDeviceLabel
      ? `${sourceType}, ${createdByDeviceLabel}`
      : sourceType;
    return await this.mint({
      name: `Ingestion key (${origin})`,
      callerUserId,
      ownerUserId,
      organizationId,
      projectId,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
    });
  }

  /**
   * The shared create step: one restricted ApiKey carrying `traces:create`
   * through a single PROJECT-scoped CUSTOM binding.
   */
  private async mint({
    name,
    callerUserId,
    ownerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId,
    createdByDeviceLabel,
  }: IngestionKeyMintParams & { name: string }): Promise<IssuedIngestionKey> {
    const { token, apiKey } = await this.apiKeys.create({
      name,
      userId: ownerUserId,
      createdByUserId: callerUserId,
      organizationId,
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      ingestSourceType: sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
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
    createdByDeviceLabel = null,
  }: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey> {
    const workspace = await this.personalWorkspace.findExisting({
      userId,
      organizationId,
    });
    if (!workspace) {
      throw new PersonalWorkspaceMissingError();
    }

    return this.ensureForProject({
      callerUserId: userId,
      // Personal-project key: owned by the user so the API-key list scopes it
      // to its owner (and org admins), never to other org members.
      ownerUserId: userId,
      organizationId,
      projectId: workspace.project.id,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
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
      lookupId: string;
      ingestionTemplateId: string | null;
    }[]
  > {
    const workspace = await this.personalWorkspace.findExisting({
      userId,
      organizationId,
    });
    if (!workspace) return [];

    const keys = await this.apiKeyRepo.findIngestKeysForProject({
      organizationId,
      projectId: workspace.project.id,
    });
    return keys
      .filter((k): k is typeof k & { ingestSourceType: string } =>
        Boolean(k.ingestSourceType),
      )
      .map((k) => ({
        apiKeyId: k.id,
        sourceType: k.ingestSourceType,
        lookupId: k.lookupId,
        ingestionTemplateId: k.ingestionTemplateId,
      }));
  }
}
