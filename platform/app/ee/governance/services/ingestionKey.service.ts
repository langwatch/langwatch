// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { ApiKeyAlreadyRevokedError } from "~/server/api-key/errors";
import {
  type ApiKeyRevocationCause,
  isApiKeyRevocationCause,
} from "~/server/api-key/revocation-cause";

import { IngestionTemplateRepository } from "../repositories/ingestionTemplate.repository";
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

/**
 * The source types a personal key may be minted for: the tools the CLI wraps
 * or captures, each stamped as `langwatch.source`. The personal mint is
 * capped per source type, so an open set would make the cap meaningless: a
 * device session could hold the cap again under every value it invents. A
 * new tool joins here when the CLI learns to wrap it.
 */
export const PERSONAL_INGEST_SOURCE_TYPES = [
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "copilot_cli",
  "copilot_vscode",
  "copilot_app",
] as const;

/**
 * The personal mint was asked for a source type no wrapped tool stamps.
 * Named so the route can answer with the request as the cause and keep every
 * other failure a server fault.
 */
export class PersonalSourceTypeNotAllowedError extends Error {
  constructor(sourceType: string) {
    super(`No personal ingestion key is minted for source type ${sourceType}.`);
    this.name = "PersonalSourceTypeNotAllowedError";
  }
}

/**
 * A rotation that could not kill every token it replaces, so it minted none.
 *
 * Rotation's whole promise is that no previous token survives it. Reporting
 * success while one is still live would hand the caller a fresh key and a
 * false statement about the old ones, so the mint is skipped and this is
 * thrown instead. Retrying is safe: the keys already revoked stay revoked.
 */
export class IngestionKeyRotationIncompleteError extends Error {
  constructor(public readonly survivingApiKeyIds: readonly string[]) {
    super(
      `Rotation left ${survivingApiKeyIds.length} prior ingestion key(s) live; no new key was minted.`,
    );
    this.name = "IngestionKeyRotationIncompleteError";
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
 * Live personal ingest keys one workspace may hold per (sourceType, template).
 * Sized for a person's real machines with room to spare: a few laptops, a few
 * cloud machines, and the forks of a golden image that share their parent's
 * key rather than minting their own.
 */
export const PERSONAL_INGEST_KEYS_PER_TOOL_CAP = 32;

const logger = createLogger("langwatch:governance:ingestion-key");

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
 *     for the same (project, sourceType) before creating the new one. This is
 *     what an explicit "rotate" means: the previous token dies now.
 *   - `issueForProject` only creates. Several machines can each hold their own
 *     live key for one (project, sourceType) pair, and revoking one machine's
 *     key leaves the others working.
 *
 * The CLI's personal-workspace mint (`issueForPersonalProject`) is the
 * create-only shape with a cap. A developer runs the same tool on a laptop, a
 * desktop and a few cloud machines under one login, and a golden VM image gets
 * forked into many; a hard-cut mint from any one of them silently killed the
 * key every other machine was still exporting with, and nothing on those
 * machines could tell. Per-machine keys end that. The cap keeps the personal
 * key list bounded without a rotation: past it, the key that has gone unused
 * the longest is revoked, which is the machine most likely gone.
 */
export class IngestionKeyService {
  private readonly apiKeys: ApiKeyService;
  private readonly apiKeyRepo: ApiKeyRepository;
  private readonly personalWorkspace: PersonalWorkspaceService;
  private readonly templates: IngestionTemplateRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.apiKeys = ApiKeyService.create(prisma);
    this.apiKeyRepo = ApiKeyRepository.create(prisma);
    this.personalWorkspace = new PersonalWorkspaceService(prisma);
    this.templates = new IngestionTemplateRepository();
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
    // Hard-cut rotation: revoke EVERY prior live ingest key for this
    // (project, sourceType, template) so no previous token survives it.
    // One key was enough while a project held one key per source; the
    // create-only mints leave several, and a rotation that kills one of them
    // hands the user a page saying rotated while two machines keep writing.
    const prior = (
      await this.apiKeyRepo.findIngestKeysForProject({
        organizationId,
        projectId,
      })
    ).filter(
      (key) =>
        key.ingestSourceType === sourceType &&
        (key.ingestionTemplateId ?? null) === ingestionTemplateId,
    );
    const survivors: string[] = [];
    for (const key of prior) {
      try {
        await this.apiKeys.revoke({
          id: key.id,
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
          cause: "rotation",
        });
      } catch (error) {
        // Someone else revoking it first is the outcome this loop wanted.
        if (error instanceof ApiKeyAlreadyRevokedError) continue;
        logger.warn(
          { error, apiKeyId: key.id, projectId, sourceType },
          "could not revoke a prior ingest key during rotation",
        );
        survivors.push(key.id);
      }
    }
    // Every prior key gets its attempt before this throws, so a retry has
    // less left to do. But a rotation that mints while one of them is still
    // live is the thing rotation exists to prevent: the caller would be
    // handed a fresh token and told the old ones are dead. Fail instead, and
    // let the retry finish the job.
    if (survivors.length > 0) {
      throw new IngestionKeyRotationIncompleteError(survivors);
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
   * Issues an ingestion key for the caller's personal project WITHOUT
   * touching the keys other machines hold for the same tool: the create-only
   * shape, held to `PERSONAL_INGEST_KEYS_PER_TOOL_CAP` live keys per
   * (workspace, sourceType, template). Past the cap the least recently used
   * key is revoked, oldest-created first among keys never used.
   *
   * The mint always succeeds and the trim follows it, so the cap is a bound
   * the next mint restores rather than one a single call holds: two devices
   * minting in the same moment can leave one key over it until either mints
   * again. See `revokePastCap` for why that trade is the right one.
   *
   * This is the CLI device-session mint (`langwatch instrument <tool>`,
   * `langwatch <tool>`): every device that signs in gets its own key, and no
   * device's mint can break another device's telemetry. The just-minted key
   * is never a candidate for the cap. Only the source types in
   * `PERSONAL_INGEST_SOURCE_TYPES` are minted, which is what bounds the
   * whole personal key set: the cap times the number of tools.
   */
  async issueForPersonalProject({
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
    if (
      !(PERSONAL_INGEST_SOURCE_TYPES as readonly string[]).includes(sourceType)
    ) {
      throw new PersonalSourceTypeNotAllowedError(sourceType);
    }
    return this.createForPersonalProject({
      userId,
      organizationId,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
    });
  }

  /**
   * Add a key to the caller's personal project without touching the keys
   * already there.
   *
   * Same create-only shape as `issueForPersonalProject`, for the callers
   * whose source type comes from the product's own catalog rather than from
   * a device: the /me Trace Ingest tile connecting a source, and the MCP
   * mint tool. Connecting a source is not a decision about the machines
   * already exporting, so it must not revoke their keys; the explicit rotate
   * is `ensureForPersonalProject`.
   *
   * The source type is still bounded, because the cap is per source type and
   * an unbounded set of them is an unbounded set of keys. A tool the CLI
   * wraps passes on its name; anything else passes by naming a published
   * template, which is an admin-created row and is what decides the source
   * type in the first place.
   */
  async createForPersonalProject({
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
    if (
      !(PERSONAL_INGEST_SOURCE_TYPES as readonly string[]).includes(sourceType)
    ) {
      await this.assertTemplateNamesSourceType({
        organizationId,
        ingestionTemplateId,
        sourceType,
      });
    }
    const workspace = await this.personalWorkspace.findExisting({
      userId,
      organizationId,
    });
    if (!workspace) {
      throw new PersonalWorkspaceMissingError();
    }
    const projectId = workspace.project.id;

    const issued = await this.issueForProject({
      callerUserId: userId,
      ownerUserId: userId,
      organizationId,
      projectId,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
    });

    await this.revokePastCap({
      callerUserId: userId,
      organizationId,
      projectId,
      sourceType,
      ingestionTemplateId,
      keepApiKeyId: issued.apiKeyId,
    });

    return issued;
  }

  /**
   * Hold a non-wrapped source type to a published template that names it.
   *
   * The template is an admin-created row, so the set of source types it can
   * name is the set the product actually knows, and the per-source cap keeps
   * meaning something. A caller inventing source types would otherwise get a
   * fresh 32-key bucket for every string it made up.
   *
   * A platform template (`organizationId: null`) counts for every
   * organization, which is what makes the shipped tiles installable.
   */
  private async assertTemplateNamesSourceType({
    organizationId,
    ingestionTemplateId,
    sourceType,
  }: {
    organizationId: string;
    ingestionTemplateId: string | null;
    sourceType: string;
  }): Promise<void> {
    if (!ingestionTemplateId) {
      throw new PersonalSourceTypeNotAllowedError(sourceType);
    }
    const template = await this.templates.findByIdForOrg(this.prisma, {
      id: ingestionTemplateId,
      organizationId,
    });
    if (template?.sourceType !== sourceType) {
      throw new PersonalSourceTypeNotAllowedError(sourceType);
    }
  }

  /**
   * The cap behind `issueForPersonalProject`: revoke live keys for the same
   * (project, sourceType, template) beyond the cap, least recently used
   * first. A key never used ranks by its creation time, so a fresh machine
   * that has not exported yet is not the first to go when the list is full.
   * Revocations do not hold for the projection, like the rotation's.
   *
   * Best-effort by design, and it runs after the new key exists. Two devices
   * minting at the same moment read the same live list and can pick the same
   * key to retire; the loser of that race gets `ApiKeyAlreadyRevokedError`,
   * and a key someone revoked from the API-keys page mid-call reads the same
   * way. Neither is a reason to fail a mint whose key is already live and
   * already returned to the device, so an eviction that fails is logged and
   * the rest still run. The bound is self-correcting: the list is recounted
   * on every mint, so a race that leaves one key over the cap is trimmed by
   * the next one.
   */
  private async revokePastCap({
    callerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId,
    keepApiKeyId,
  }: {
    callerUserId: string;
    organizationId: string;
    projectId: string;
    sourceType: string;
    ingestionTemplateId: string | null;
    keepApiKeyId: string;
  }): Promise<void> {
    const live = (
      await this.apiKeyRepo.findIngestKeysForProject({
        organizationId,
        projectId,
      })
    ).filter(
      (key) =>
        key.id !== keepApiKeyId &&
        key.ingestSourceType === sourceType &&
        (key.ingestionTemplateId ?? null) === ingestionTemplateId,
    );
    // The kept key counts toward the cap, so the others may fill cap - 1.
    const excess = live.length - (PERSONAL_INGEST_KEYS_PER_TOOL_CAP - 1);
    if (excess <= 0) return;

    const lastActivityMs = (key: (typeof live)[number]): number =>
      (key.lastUsedAt ?? key.createdAt).getTime();
    const doomed = [...live]
      .sort((a, b) => lastActivityMs(a) - lastActivityMs(b))
      .slice(0, excess);
    for (const key of doomed) {
      try {
        await this.apiKeys.revoke({
          id: key.id,
          callerUserId,
          callerIsAdmin: true,
          organizationId,
          awaitProjection: false,
          cause: "cap",
        });
      } catch (error) {
        logger.warn(
          { error, apiKeyId: key.id, projectId, sourceType },
          "could not retire a personal ingest key past the cap",
        );
      }
    }
  }

  /**
   * Issues an ingestion key for the caller's personal project in the given org,
   * rotating in place: an explicit rotate from the /me tile and personal
   * template installs (with a templateId). The CLI device mint uses
   * `issueForPersonalProject` instead, so a machine never rotates another's key.
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

  /**
   * What became of one of the caller's own personal ingest keys, looked up by
   * the lookup id embedded in its token. The CLI asks this before it re-mints
   * a key the collector rejected: a key the cap retired or a rotation replaced
   * may be re-minted, a key a person revoked may not.
   *
   * Null when no such key belongs to this user in this organization, which is
   * also what a key of another user reads as: the answer never confirms that
   * someone else's key exists.
   */
  async describePersonalKey({
    userId,
    organizationId,
    lookupId,
  }: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<{
    sourceType: string;
    live: boolean;
    revocationCause: ApiKeyRevocationCause | null;
  } | null> {
    const key = await this.apiKeyRepo.findByLookupId({ lookupId });
    if (
      !key ||
      key.organizationId !== organizationId ||
      key.userId !== userId ||
      !key.ingestSourceType
    ) {
      return null;
    }
    return {
      sourceType: key.ingestSourceType,
      live: key.revokedAt === null,
      revocationCause: isApiKeyRevocationCause(key.revocationCause)
        ? key.revocationCause
        : null,
    };
  }
}
