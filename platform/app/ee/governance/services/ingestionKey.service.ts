// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  ApiKeyRepository,
  type ApiKeyWithBindings,
} from "~/server/api-key/api-key.repository";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { ApiKeyAlreadyRevokedError } from "~/server/api-key/errors";
import {
  type ApiKeyRevocationCause,
  isApiKeyRevocationCause,
} from "~/server/api-key/revocation-cause";

import { IngestionTemplateRepository } from "../repositories/ingestionTemplate.repository";
import {
  IngestionKeyNotFoundError,
  IngestionKeyRevokeIncompleteError,
  IngestionKeySessionRevokedError,
  IngestionKeySourceNotAllowedError,
  IngestionKeyWorkspaceMissingError,
} from "./ingestionKey.errors";
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
  /** The session's CLI login key, for keys minted by a CLI session. */
  parentApiKeyId?: string | null;
}

/**
 * The source types the CLI wraps or captures, each stamped as
 * `langwatch.source`. A personal key for one of these comes from the CLI on
 * the machine that runs the tool, under that machine's session, and from
 * nowhere else: the tile and the MCP mint have no session to parent a key
 * to. A new tool joins here when the CLI learns to wrap it.
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

/** The plaintext token, returned exactly once, plus its identifiers. */
export interface IssuedIngestionKey {
  token: string;
  apiKeyId: string;
  prefix: string;
  sourceType: string;
}

/** One of the caller's live personal ingestion keys, without its secret. */
export interface PersonalIngestionKey {
  apiKeyId: string;
  name: string;
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
  /** The device that minted it, null for keys minted outside a CLI session. */
  deviceLabel: string | null;
  /** The CLI login key it lives and dies with, null outside a CLI session. */
  parentApiKeyId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number | null;
}

const logger = createLogger("langwatch:governance:ingestion-key");

/**
 * Issues, lists and revokes "ingestion keys": project-scoped, ingest-only
 * ApiKeys.
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
 * A personal key belongs to the CLI session that minted it. A person runs one
 * tool from a laptop, a desktop and a few cloud machines under one login;
 * each machine signs in and mints its own key under its own login key
 * (`parentApiKeyId`), and the key is retired when that login key is: logout,
 * the devices tab, a re-login from the same device, session expiry. The mint
 * itself never revokes anything, so no machine's setup can break another's.
 *
 * Keys minted outside a CLI session (the /me tile, the MCP mint) have no
 * parent and are accepted only for sources a published template names and no
 * CLI wrapper covers. They stay until a person revokes them, one at a time or
 * every key of a source at once through the tile's rotate.
 *
 * `issueForProject` is the pinned `--project` path: an org service key for a
 * named project, outside this lifecycle. It has no session and is retired
 * only by a person's revoke.
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
   * Issues an ingestion key for a specific project WITHOUT touching the keys
   * that already exist for that (project, sourceType). Returns the plaintext
   * token exactly once.
   *
   * The pinned `--project` path. Two laptops working on the same repository
   * each hold their own token, so one developer re-running the setup does
   * not silently kill the other's telemetry. The key name carries the source
   * type and the minting device, so the API-keys settings page shows where
   * each row came from. `ownerUserId` decides API-key list visibility: the
   * owning user for a personal-project key, `null` for a shared project's
   * org service key.
   */
  async issueForProject({
    callerUserId,
    ownerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId = null,
    createdByDeviceLabel = null,
    parentApiKeyId = null,
  }: IngestionKeyMintParams): Promise<IssuedIngestionKey> {
    const origin = createdByDeviceLabel
      ? `${sourceType}, ${createdByDeviceLabel}`
      : sourceType;
    return await this.createKey({
      name: `Ingestion key (${origin})`,
      callerUserId,
      ownerUserId,
      organizationId,
      projectId,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
      parentApiKeyId,
    });
  }

  /**
   * Mints a key into the caller's personal workspace.
   *
   * With `parentApiKeyId`, this is the CLI session mint (`langwatch
   * instrument <tool>`, `langwatch <tool>`): the source type must be a tool
   * the CLI wraps, and the login key must still be live, or the device is
   * signed out and answers so. Without a parent, this is the tile or the MCP
   * mint: the source type must be one a published template names, and a tool
   * the CLI wraps is refused, because a key for it belongs to the machine
   * that runs it.
   *
   * Create-only in both shapes: the keys other machines hold stay live.
   */
  async mint({
    userId,
    organizationId,
    sourceType,
    ingestionTemplateId = null,
    parentApiKeyId = null,
    createdByDeviceLabel = null,
  }: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    parentApiKeyId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey> {
    if (parentApiKeyId) {
      if (!isWrappedTool(sourceType)) {
        throw new IngestionKeySourceNotAllowedError(sourceType);
      }
      await this.assertSessionLive({ parentApiKeyId, userId, organizationId });
    } else {
      await this.assertMintableWithoutSession({
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
      throw new IngestionKeyWorkspaceMissingError();
    }

    return await this.issueForProject({
      callerUserId: userId,
      ownerUserId: userId,
      organizationId,
      projectId: workspace.project.id,
      sourceType,
      ingestionTemplateId,
      createdByDeviceLabel,
      parentApiKeyId,
    });
  }

  /**
   * Revokes one of the caller's own personal ingestion keys, as a person's
   * decision (cause `user`). Another person's key, a key outside this
   * organization and a key that is not an ingestion key all read as not
   * found, so the answer never confirms one exists. A key already revoked is
   * left as it is: the person asked for a dead key and has one.
   */
  async revoke({
    userId,
    organizationId,
    apiKeyId,
  }: {
    userId: string;
    organizationId: string;
    apiKeyId: string;
  }): Promise<void> {
    const key = await this.apiKeyRepo.findById({ id: apiKeyId });
    if (
      !key ||
      key.organizationId !== organizationId ||
      key.userId !== userId ||
      !key.ingestSourceType
    ) {
      throw new IngestionKeyNotFoundError(apiKeyId);
    }
    if (key.revokedAt) return;
    try {
      await this.apiKeys.revoke({
        id: key.id,
        callerUserId: userId,
        callerIsAdmin: false,
        organizationId,
        cause: "user",
      });
    } catch (error) {
      if (ApiKeyAlreadyRevokedError.is(error)) return;
      throw error;
    }
  }

  /**
   * Retires every live ingestion key minted under one CLI login key: the
   * cascade a login-key revoke runs. `session` when the login key was
   * revoked, `expired` when its session ran out. Each key gets its attempt
   * even if another fails, and the count is what was revoked here; a key
   * someone revoked a moment earlier is the outcome this wanted.
   */
  async revokeForSession({
    parentApiKeyId,
    userId,
    organizationId,
    cause,
  }: {
    parentApiKeyId: string;
    userId: string;
    organizationId: string;
    cause: "session" | "expired";
  }): Promise<{ revokedCount: number }> {
    const children = (
      await this.apiKeyRepo.findIngestKeysForUser({ organizationId, userId })
    ).filter((key) => key.parentApiKeyId === parentApiKeyId);

    let revokedCount = 0;
    let failed = 0;
    for (const key of children) {
      try {
        await this.apiKeys.revoke({
          id: key.id,
          callerUserId: userId,
          callerIsAdmin: false,
          organizationId,
          awaitProjection: false,
          cause,
        });
        revokedCount += 1;
      } catch (error) {
        if (ApiKeyAlreadyRevokedError.is(error)) continue;
        failed += 1;
        logger.warn(
          { error, apiKeyId: key.id, parentApiKeyId, cause },
          "could not revoke an ingest key with its session",
        );
      }
    }
    if (failed > 0) {
      throw new Error(
        `${failed} ingest key(s) under login key ${parentApiKeyId} could not be revoked`,
      );
    }
    return { revokedCount };
  }

  /**
   * Retires every live key of one (source type, template) in the caller's
   * personal workspace, across every machine: the first half of the tile's
   * rotate. Refuses a tool the CLI wraps before touching anything, since a
   * rotate that could not mint the replacement would only leave the source
   * dead.
   *
   * Every key gets its attempt, so a retry has less left to do, but a key
   * that survives fails the call: the caller was about to mint a replacement
   * and tell the person the old tokens are dead, and one of them is not.
   * Returns the devices whose keys were retired, for the person to read.
   */
  async revokeForSource({
    userId,
    organizationId,
    sourceType,
    ingestionTemplateId = null,
  }: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
  }): Promise<{ revokedCount: number; deviceLabels: string[] }> {
    await this.assertMintableWithoutSession({
      organizationId,
      ingestionTemplateId,
      sourceType,
    });

    const prior = (
      await this.apiKeyRepo.findIngestKeysForUser({ organizationId, userId })
    ).filter(
      (key) =>
        key.ingestSourceType === sourceType &&
        (key.ingestionTemplateId ?? null) === ingestionTemplateId,
    );

    const deviceLabels: string[] = [];
    const survivors: string[] = [];
    let revokedCount = 0;
    for (const key of prior) {
      try {
        await this.apiKeys.revoke({
          id: key.id,
          callerUserId: userId,
          callerIsAdmin: false,
          organizationId,
          // The prior key is dead the moment its row is revoked, and its
          // private role is named after that key id, so the mint that
          // follows never waits for the name.
          awaitProjection: false,
          cause: "rotation",
        });
        revokedCount += 1;
        deviceLabels.push(labelOf(key));
      } catch (error) {
        if (ApiKeyAlreadyRevokedError.is(error)) continue;
        logger.warn(
          { error, apiKeyId: key.id, sourceType },
          "could not revoke a prior ingest key during rotation",
        );
        survivors.push(labelOf(key));
      }
    }
    if (survivors.length > 0) {
      throw new IngestionKeyRevokeIncompleteError(survivors);
    }
    return { revokedCount, deviceLabels };
  }

  /**
   * The caller's live personal ingestion keys in this organization, newest
   * first, with the session each belongs to. The plaintext token is never
   * returned here; only a mint reveals it, once.
   */
  async list({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]> {
    const keys = await this.apiKeyRepo.findIngestKeysForUser({
      organizationId,
      userId,
    });
    return keys
      .filter((key): key is typeof key & { ingestSourceType: string } =>
        Boolean(key.ingestSourceType),
      )
      .map((key) => ({
        apiKeyId: key.id,
        name: key.name,
        sourceType: key.ingestSourceType,
        lookupId: key.lookupId,
        ingestionTemplateId: key.ingestionTemplateId,
        deviceLabel: key.createdByDeviceLabel,
        parentApiKeyId: key.parentApiKeyId,
        createdAtMs: key.createdAt.getTime(),
        lastUsedAtMs: key.lastUsedAt?.getTime() ?? null,
      }));
  }

  /**
   * What became of one of the caller's own personal ingest keys, looked up by
   * the lookup id embedded in its token. The CLI asks this before it re-mints
   * a key the collector rejected: a key retired with its session or replaced
   * by a rotation may be re-minted, a key a person revoked may not.
   *
   * Null when no such key belongs to this user in this organization, which is
   * also what a key of another user reads as: the answer never confirms that
   * someone else's key exists.
   */
  async describe({
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

  /**
   * The shared create step: one restricted ApiKey carrying `traces:create`
   * through a single PROJECT-scoped CUSTOM binding.
   */
  private async createKey({
    name,
    callerUserId,
    ownerUserId,
    organizationId,
    projectId,
    sourceType,
    ingestionTemplateId,
    createdByDeviceLabel,
    parentApiKeyId,
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
      parentApiKeyId,
    });

    return {
      token,
      apiKeyId: apiKey.id,
      prefix: token.slice(0, 12),
      sourceType,
    };
  }

  /**
   * A session mint needs a live login key. A login key already revoked means
   * the session was logged out, revoked, replaced or expired, and a key
   * minted under it now would be orphaned from every cascade that follows.
   */
  private async assertSessionLive({
    parentApiKeyId,
    userId,
    organizationId,
  }: {
    parentApiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const parent = await this.apiKeyRepo.findById({ id: parentApiKeyId });
    if (
      !parent ||
      parent.organizationId !== organizationId ||
      parent.userId !== userId ||
      parent.revokedAt !== null
    ) {
      throw new IngestionKeySessionRevokedError();
    }
  }

  /**
   * The source types a mint with no session may name: those a published
   * template names, and none the CLI wraps. The template is an admin-created
   * row, so the set of source types it can name is the set the product
   * knows. A platform template (`organizationId: null`) counts for every
   * organization, which is what makes the shipped tiles installable.
   */
  private async assertMintableWithoutSession({
    organizationId,
    ingestionTemplateId,
    sourceType,
  }: {
    organizationId: string;
    ingestionTemplateId: string | null;
    sourceType: string;
  }): Promise<void> {
    if (isWrappedTool(sourceType) || !ingestionTemplateId) {
      throw new IngestionKeySourceNotAllowedError(sourceType);
    }
    const template = await this.templates.findByIdForOrg(this.prisma, {
      id: ingestionTemplateId,
      organizationId,
    });
    if (template?.sourceType !== sourceType) {
      throw new IngestionKeySourceNotAllowedError(sourceType);
    }
  }
}

function isWrappedTool(sourceType: string): boolean {
  return (PERSONAL_INGEST_SOURCE_TYPES as readonly string[]).includes(
    sourceType,
  );
}

/** How a key is named to a person: its device, else the key's own name. */
function labelOf(key: ApiKeyWithBindings): string {
  return key.createdByDeviceLabel ?? key.name;
}
