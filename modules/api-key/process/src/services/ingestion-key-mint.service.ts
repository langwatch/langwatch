import {
  ApiKeyScopeViolationError,
  INGESTION_PERMISSIONS,
  type ApiKey,
  type ApiKeyApi,
  type CreateIngestionKeyInput,
} from "@langwatch/api-key-contract";

import { isIngestionShape } from "../rules/ingestion-key.rules.ts";

/**
 * A person's project-bound sign-in mints their own ingestion key here, and nothing else does: a
 * key cannot mint one, so a leaked key cannot breed. Refuses a non-person first, then any shape.
 */
export class IngestionKeyMintService {
  static create(options: { apiKeys: Pick<ApiKeyApi, "create"> }): IngestionKeyMintService {
    return new IngestionKeyMintService(options);
  }

  private constructor(private readonly options: { apiKeys: Pick<ApiKeyApi, "create"> }) {}

  async createIngestionKey(
    input: CreateIngestionKeyInput,
  ): Promise<{ token: string; apiKey: ApiKey }> {
    const { key, principal, organizationId, projectId } = input;
    if (principal?.type !== "user") {
      throw new ApiKeyScopeViolationError("Only a person's sign-in session mints an ingestion key");
    }
    const userId = principal.id;
    if (!isIngestionShape({ input: key, projectId, callerUserId: userId })) {
      throw new ApiKeyScopeViolationError(
        "An ingestion key is personal, bound to this one project, and holds only ingestion",
      );
    }

    return this.options.apiKeys.create({
      name: key.name,
      description: key.description,
      userId,
      createdByUserId: userId,
      organizationId,
      expiresAt: key.expiresAt,
      permissionMode: "restricted",
      permissions: [...INGESTION_PERMISSIONS],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
    });
  }
}
