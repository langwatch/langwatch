import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import {
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
import type { ProjectIdentity } from "@langwatch/project-contract";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";
import { Temporal, fromDate, nowInstant } from "@langwatch/time";

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
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
  ): ApiKeyTokenResolutionService {
    return new ApiKeyTokenResolutionService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {}

  async findVerifiedToken({
    token,
  }: {
    token: string;
  }): Promise<import("@langwatch/api-key-contract").ApiKeyVerification | null> {
    const split = this.findTokenParts(token);
    if (!split) {
      return null;
    }

    const row = await this.repository.findByLookupId({ lookupId: split.lookupId });
    const expired =
      row?.expiresAt != null && Temporal.Instant.compare(fromDate(row.expiresAt), nowInstant()) < 0;
    if (!row || row.revokedAt || expired) {
      return null;
    }

    // A key minted under a CLI session cannot outlive that session. The
    // cascade retires it when the login key is revoked, but the cascade is
    // one caller's work and a credential must not depend on it having run: a
    // transient failure mid-cascade, or a revoke through a path with no
    // cascade behind it, would otherwise leave this key authenticating under
    // a session that ended. The parent is the authority, so this is the one
    // place that has to agree with it.
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

    this.options.legacyGrants.mint(publicApiKey(row));

    return { ...publicApiKey(row), tokenType: "apiKey" };
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
   * Whether the CLI login key a key was minted under is still live.
   *
   * A parent that is gone reads as dead: the row is the only record of the
   * session, so its absence is not something to authenticate past. Expiry
   * counts as well as revocation, which is what retires the children of a
   * session that ran out in the window before the hourly sweep reaches it.
   */
  private async isParentLive(parentApiKeyId: string): Promise<boolean> {
    const parent = await this.repository.findLivenessById({ id: parentApiKeyId });
    if (!parent || parent.revokedAt) return false;
    return !(parent.expiresAt && Temporal.Instant.compare(parent.expiresAt, nowInstant()) < 0);
  }

  private async findLegacyProjectKeyResolution(
    token: string,
  ): Promise<ResolvedApiKeyCredential | null> {
    const projectId = await this.options.projects.findIdByLegacyApiKey({ token });
    if (!projectId) {
      return null;
    }

    const project = await this.options.projects.findIdentity(projectId);

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
          apiKey.roleBindings.flatMap((binding) =>
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

    const project = await this.options.projects.findIdentity(effectiveProjectId);
    if (!project || project.organizationId !== apiKey.organizationId) {
      return null;
    }

    // Only a caller-NAMED project needs this: a self-scoped resolution derived
    // the project from a binding already.
    if (projectId && !bindingsReachProject(apiKey.roleBindings, project)) {
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
}
