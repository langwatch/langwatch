import {
  ApiKeyAlreadyRevokedError,
  ApiKeyExpiredError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  type ApiKey,
  type RotateApiKeyInput,
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  isSystemApiKey,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import { ApiKeyGrantsService } from "./api-key-grants.service.ts";
import type { ApiKeyTokenResolutionService } from "./api-key-token-resolution.service.ts";
import type { ApiKeyTokenService } from "./api-key-token.service.ts";

/**
 * A new secret for the same key: a new lookup id and hash on the same row, so its id, settings,
 * grants and usage stay. The old lookup id's shared answer becomes a refusal, as on revoke, so
 * the old secret is refused at once on every pod. Spec: specs/api-keys/api-key-rotation.feature
 */
export class ApiKeyRotationService {
  static create(options: {
    repository: ApiKeyRepository;
    authz: Pick<AuthzApi, "listApiKeyBindings" | "listScopeBindings">;
    tokens: ApiKeyTokenService;
    answers: Pick<ApiKeyTokenResolutionService, "forget">;
  }): ApiKeyRotationService {
    return new ApiKeyRotationService({
      repository: options.repository,
      bindings: ApiKeyGrantsService.create({ authz: options.authz }),
      tokens: options.tokens,
      answers: options.answers,
    });
  }

  private readonly repository: ApiKeyRepository;
  private readonly bindings: ApiKeyGrantsService;
  private readonly tokens: ApiKeyTokenService;
  private readonly answers: Pick<ApiKeyTokenResolutionService, "forget">;

  private constructor(deps: {
    repository: ApiKeyRepository;
    bindings: ApiKeyGrantsService;
    tokens: ApiKeyTokenService;
    answers: Pick<ApiKeyTokenResolutionService, "forget">;
  }) {
    this.repository = deps.repository;
    this.bindings = deps.bindings;
    this.tokens = deps.tokens;
    this.answers = deps.answers;
  }

  /** The same caller rule as revoke: the owner, or an organization admin. */
  async rotate(input: RotateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }> {
    const existing = await this.repository.findByIdInOrganization(input);
    if (!existing || isSystemApiKey(existing)) {
      throw new ApiKeyNotFoundError(input.id);
    }

    if (
      !input.callerIsAdmin &&
      (existing.userId === null || existing.userId !== input.callerUserId)
    ) {
      throw new ApiKeyNotOwnedError(input.id);
    }

    if (existing.revokedAt) {
      throw new ApiKeyAlreadyRevokedError(input.id);
    }

    if (existing.expiresAt && toEpochMs(existing.expiresAt) <= nowInstant().epochMilliseconds) {
      throw new ApiKeyExpiredError(input.id);
    }

    const generated = this.tokens.generate({
      prefix: existing.ingestSourceType ? INGEST_KEY_PREFIX : API_KEY_PREFIX,
    });
    const rotated = await this.repository.rotateSecret({
      id: input.id,
      organizationId: input.organizationId,
      lookupId: generated.lookupId,
      hashedSecret: generated.hashedSecret,
    });
    await this.answers.forget({ lookupId: existing.lookupId, revoked: true });

    const { hashedSecret: _hashedSecret, ...apiKey } = await this.bindings.attachOne(rotated);
    return { token: generated.token, apiKey };
  }
}
