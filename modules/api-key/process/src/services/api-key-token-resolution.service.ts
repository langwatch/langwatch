import { createHash } from "node:crypto";

import {
  ApiKeyNotFoundError,
  apiKeyTokenResolutionInputSchema,
  getTokenType,
  organizationApiKeyResolutionInputSchema,
  organizationApiKeyResolutionSchema,
  resolvedApiKeyTokenSchema,
  type ApiKey,
  type ApiKeyBinding,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyCredential,
  API_KEY_PREFIX,
  LANGY_SESSION_API_KEY_NAME,
} from "@langwatch/api-key-contract";
import type * as apiKeyContractModule from "@langwatch/api-key-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { Temporal, fromDate, nowInstant, type Instant } from "@langwatch/time";

import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository.ts";
import { ApiKeyGrantsService } from "./api-key-grants.service.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";

/** How long a key's answer is trusted: the bound on a revocation reaching every process. */
export const API_KEY_ANSWER_TTL_MS = 5_000;
/** How long "no such key" is trusted, so a flood of unknown tokens meets one read a moment. */
export const API_KEY_UNKNOWN_TTL_MS = 2_000;
const MAX_REMEMBERED = 10_000;

type Remembered<T> = Map<string, { value: Promise<T>; until: number }>;

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;

  return key;
}

/**
 * Whether the key's own grants reach the project a caller named. An organization binding
 * reaches every project in it, a team binding every project on that team, a project binding
 * only its own.
 */
function bindingsReachProject(
  // The two fields the answer turns on, rather than the whole binding: the
  // verified key carries the schema's own rows, whose optional `customRoleId`
  // is not the narrowed one `ApiKeyBinding` states, and neither field below is
  // that one.
  bindings: readonly Pick<ApiKeyBinding, "scopeType" | "scopeId">[],
  project: ProjectIdentity,
): boolean {
  return bindings.some((binding) => {
    if (binding.scopeType === "ORGANIZATION") {
      return binding.scopeId === project.organizationId;
    }

    if (binding.scopeType === "TEAM") {
      return binding.scopeId === project.teamId;
    }

    return binding.scopeId === project.id;
  });
}

export class ApiKeyTokenResolutionService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository; now?: () => Instant },
  ): ApiKeyTokenResolutionService {
    return new ApiKeyTokenResolutionService(options.repository, options);
  }

  private readonly bindings: ApiKeyGrantsService;
  readonly #verified: Remembered<apiKeyContractModule.ApiKeyVerification | null> = new Map();
  readonly #legacyProjectIds: Remembered<string | null> = new Map();
  readonly #projects: Remembered<ProjectIdentity | null> = new Map();

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies & { now?: () => Instant },
  ) {
    this.bindings = ApiKeyGrantsService.create({ authz: options.authz });
  }

  /** Drops every remembered answer: this process changed a key, so its next read is fresh. */
  forget(): void {
    this.#verified.clear();
    this.#legacyProjectIds.clear();
    this.#projects.clear();
  }

  /**
   * Keyed by the whole token's hash, so a wrong secret is its own miss and is verified in
   * full. An answer lapses at the key's own expiry when that comes sooner.
   */
  findVerifiedToken({
    token,
  }: {
    token: string;
  }): Promise<apiKeyContractModule.ApiKeyVerification | null> {
    return this.remember({
      entries: this.#verified,
      key: tokenHash(token),
      read: () => this.readVerifiedToken({ token }),
      lifeMs: (verified) =>
        verified?.expiresAt
          ? Math.min(API_KEY_ANSWER_TTL_MS, verified.expiresAt.getTime() - this.nowMs())
          : answerLife(verified),
    });
  }

  private async readVerifiedToken({
    token,
  }: {
    token: string;
  }): Promise<apiKeyContractModule.ApiKeyVerification | null> {
    const split = this.findTokenParts(token);
    if (!split) {
      return null;
    }

    const row = await this.repository.findByLookupId({ lookupId: split.lookupId });
    const expired =
      row?.expiresAt != null && Temporal.Instant.compare(fromDate(row.expiresAt), this.now()) < 0;
    if (!row || row.revokedAt || expired) {
      return null;
    }

    // A key minted under a CLI session cannot outlive it — the cascade
    // retires it on revoke, but that is one caller's work. A transient
    // failure or a cascade-less revoke path must not leave this key alive,
    // so this checks the parent directly: it is the authority.
    if (row.parentApiKeyId && !(await this.isParentLive(row.parentApiKeyId))) {
      return null;
    }

    const verification = this.options.tokens.verify(split.secret, row.hashedSecret);
    if (verification === "no_match") {
      return null;
    }

    if (verification === "match_legacy") {
      void this.repository
        .upgradeHash({ id: row.id, hashedSecret: this.options.tokens.hash(split.secret) })
        .catch(() => void 0);
    }

    const key = publicApiKey(await this.bindings.attachOne(row));
    this.options.legacyGrants.mint(key);

    return { ...key, tokenType: "apiKey" };
  }

  async findResolvedToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyCredential | null> {
    const parsed = apiKeyTokenResolutionInputSchema.parse(input);
    const tokenType = getTokenType(parsed.token);

    if (tokenType === "legacyProjectKey") {
      return this.findLegacyProjectKeyResolution(parsed.token);
    }

    if (tokenType === "apiKey") {
      const resolved = await this.findCurrentApiKeyResolution(
        parsed.token,
        parsed.projectId ?? null,
      );
      if (resolved) {
        return resolved;
      }

      if (parsed.token.startsWith(API_KEY_PREFIX)) {
        return this.findLegacyProjectKeyResolution(parsed.token);
      }

      return null;
    }

    return this.findLegacyProjectKeyResolution(parsed.token);
  }

  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    const token = this.options.tokens.generateLegacyProjectKey();
    const rotated = await this.options.projects.rotateLegacyApiKey({
      projectId: input.projectId,
      token,
    });
    this.forget();
    if (!rotated) {
      throw new ApiKeyNotFoundError(input.projectId);
    }

    return token;
  }

  async resolveOrganizationToken(input: { token: string }): Promise<OrganizationApiKeyResolution> {
    const parsed = organizationApiKeyResolutionInputSchema.parse(input);
    if (getTokenType(parsed.token) === "apiKey") {
      const apiKey = await this.findVerifiedToken({ token: parsed.token });
      if (apiKey) {
        return organizationApiKeyResolutionSchema.parse({
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: apiKey.id,
            userId: apiKey.userId,
            organizationId: apiKey.organizationId,
          },
        });
      }
    }

    const legacy = await this.findLegacyProjectKeyResolution(parsed.token);

    return organizationApiKeyResolutionSchema.parse(
      legacy
        ? { ok: false, reason: "wrong_credential_class" }
        : { ok: false, reason: "unusable_credential" },
    );
  }

  private findTokenParts(token: string): { lookupId: string; secret: string } | null {
    return this.options.tokens.findTokenParts(token);
  }

  /**
   * Whether the CLI login key a key was minted under is still live. A
   * parent that is gone reads as dead — its absence is not something to
   * authenticate past. Expiry counts too, ahead of the hourly sweep.
   */
  private async isParentLive(parentApiKeyId: string): Promise<boolean> {
    const parent = await this.repository.findLivenessById({ id: parentApiKeyId });
    if (!parent || parent.revokedAt) return false;
    return !(parent.expiresAt && Temporal.Instant.compare(parent.expiresAt, this.now()) < 0);
  }

  private async findLegacyProjectKeyResolution(
    token: string,
  ): Promise<ResolvedApiKeyCredential | null> {
    const projectId = await this.remember({
      entries: this.#legacyProjectIds,
      key: tokenHash(token),
      read: () => this.options.projects.findIdByLegacyApiKey({ token }),
      lifeMs: answerLife,
    });
    if (!projectId) {
      return null;
    }

    const project = await this.findProjectIdentity(projectId);

    return project ? resolvedApiKeyTokenSchema.parse({ type: "legacyProjectKey", project }) : null;
  }

  private async findCurrentApiKeyResolution(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedApiKeyCredential | null> {
    const apiKey = await this.findVerifiedToken({ token });
    if (!apiKey) {
      return null;
    }

    let effectiveProjectId = projectId;
    if (!effectiveProjectId) {
      const projectIds = [
        ...new Set(
          apiKey.grants.flatMap((binding) =>
            binding.scopeType === "PROJECT" && binding.scopeId ? [binding.scopeId] : [],
          ),
        ),
      ];
      if (projectIds.length === 1) {
        effectiveProjectId = projectIds[0] ?? null;
      }
    }

    if (!effectiveProjectId) {
      return null;
    }

    const project = await this.findProjectIdentity(effectiveProjectId);
    if (!project || project.organizationId !== apiKey.organizationId) {
      return null;
    }

    // Only a caller-NAMED project needs this: a self-scoped resolution derived
    // the project from a binding already.
    if (projectId && !bindingsReachProject(apiKey.grants, project)) {
      return null;
    }

    return resolvedApiKeyTokenSchema.parse({
      type: "apiKey",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      ingestSourceType: apiKey.ingestSourceType,
      ingestionTemplateId: apiKey.ingestionTemplateId,
      isLangySessionKey: apiKey.name === LANGY_SESSION_API_KEY_NAME,
      project,
    });
  }

  private findProjectIdentity(projectId: string): Promise<ProjectIdentity | null> {
    return this.remember({
      entries: this.#projects,
      key: projectId,
      read: () => this.options.projects.findIdentity(projectId),
      lifeMs: answerLife,
    });
  }

  /** One read per key per lifetime, shared by concurrent callers; a failed read is not kept. */
  private remember<T>({
    entries,
    key,
    read,
    lifeMs,
  }: {
    entries: Remembered<T>;
    key: string;
    read: () => Promise<T>;
    lifeMs: (value: T) => number;
  }): Promise<T> {
    const nowMs = this.nowMs();
    const remembered = entries.get(key);
    if (remembered && remembered.until > nowMs) return remembered.value;

    const value = read();
    const entry = { value, until: nowMs + API_KEY_UNKNOWN_TTL_MS };
    if (entries.size >= MAX_REMEMBERED) {
      const oldest = entries.keys().next().value;
      if (oldest !== void 0) entries.delete(oldest);
    }
    entries.set(key, entry);
    value
      .then((answer) => {
        entry.until = nowMs + lifeMs(answer);
      })
      .catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });

    return value;
  }

  private now(): Instant {
    return (this.options.now ?? nowInstant)();
  }

  private nowMs(): number {
    return this.now().epochMilliseconds;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function answerLife(answer: unknown): number {
  return answer ? API_KEY_ANSWER_TTL_MS : API_KEY_UNKNOWN_TTL_MS;
}
