import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import {
  apiKeyTokenResolutionInputSchema,
  getTokenType,
  organizationApiKeyResolutionInputSchema,
  organizationApiKeyResolutionSchema,
  resolvedApiKeyTokenSchema,
  type ApiKey,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyToken,
  API_KEY_PREFIX,
  LANGY_SESSION_API_KEY_NAME,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository";
import type { ApiKeyDependencies } from "./api-key.service";

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;
  return key;
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

  async tryVerify({
    token,
  }: {
    token: string;
  }): Promise<import("@langwatch/api-key-contract").ApiKeyVerification | null> {
    const split = this.trySplitToken(token);
    if (!split) {
      return null;
    }
    const row = await this.repository.tryFindByLookupId({ lookupId: split.lookupId });
    if (!row || row.revokedAt || (row.expiresAt !== null && row.expiresAt < new Date())) {
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

  async tryResolveToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyToken | null> {
    const parsed = apiKeyTokenResolutionInputSchema.parse(input);
    const tokenType = getTokenType(parsed.token);

    if (tokenType === "legacyProjectKey") {
      return this.tryResolveLegacyProjectKey(parsed.token);
    }

    if (tokenType === "apiKey") {
      const resolved = await this.tryResolveCurrentApiKey(parsed.token, parsed.projectId ?? null);
      if (resolved) {
        return resolved;
      }
      if (parsed.token.startsWith(API_KEY_PREFIX)) {
        return this.tryResolveLegacyProjectKey(parsed.token);
      }
      return null;
    }

    return this.tryResolveLegacyProjectKey(parsed.token);
  }

  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    const token = this.options.tokens.generateLegacyProjectKey();
    const rotated = await this.repository.rotateLegacyProjectKey({
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
      const apiKey = await this.tryVerify({ token: parsed.token });
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

    const legacy = await this.tryResolveLegacyProjectKey(parsed.token);
    return organizationApiKeyResolutionSchema.parse(
      legacy
        ? { ok: false, reason: "wrong_credential_class" }
        : { ok: false, reason: "unusable_credential" },
    );
  }

  private trySplitToken(token: string): { lookupId: string; secret: string } | null {
    return this.options.tokens.trySplit(token);
  }

  private async tryResolveLegacyProjectKey(token: string): Promise<ResolvedApiKeyToken | null> {
    const projectId = await this.repository.tryFindLegacyProjectId({ token });
    if (!projectId) {
      return null;
    }
    const project = await this.options.projects.tryGetIdentity(projectId);
    return project ? resolvedApiKeyTokenSchema.parse({ type: "legacyProjectKey", project }) : null;
  }

  private async tryResolveCurrentApiKey(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedApiKeyToken | null> {
    const apiKey = await this.tryVerify({ token });
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

    const project = await this.options.projects.tryGetIdentity(effectiveProjectId);
    if (!project || project.organizationId !== apiKey.organizationId) {
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
