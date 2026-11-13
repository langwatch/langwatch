import {
  ApiKeyScopeViolationError,
  STAFF_ACCESS_KEY_MAX_LIFETIME_MS,
  STAFF_READ_KEY_NAME,
  STAFF_SUPPORT_KEY_NAME,
  isStaffAccessApiKey,
  mintStaffAccessKeyInputSchema,
  revokeStaffAccessKeyInputSchema,
  type ApiKeyApi,
  type MintStaffAccessKeyInput,
  type RevokeStaffAccessKeyInput,
  type StaffAccessKeyMinted,
} from "@langwatch/api-key-contract";
import {
  STAFF_READER_CONTENT_PERMISSIONS,
  STAFF_READER_METADATA_PERMISSIONS,
  STAFF_SUPPORT_WRITE_PERMISSIONS,
} from "@langwatch/authz-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import type { ApiKeyLifecycleService } from "./api-key-lifecycle.service.ts";

type StaffAccessKeyServiceOptions = Readonly<{
  apiKeys: Pick<ApiKeyApi, "create">;
  lifecycle: Pick<ApiKeyLifecycleService, "revokeSystemManaged">;
  repository: Pick<ApiKeyRepository, "findById">;
  now?: () => Instant;
}>;

const READ_BAG: ReadonlySet<string> = new Set([
  ...STAFF_READER_METADATA_PERMISSIONS,
  ...STAFF_READER_CONTENT_PERMISSIONS,
]);
const SUPPORT_BAG: ReadonlySet<string> = new Set([...READ_BAG, ...STAFF_SUPPORT_WRITE_PERMISSIONS]);

/**
 * Staff access keys (ADR-202): ownerless, system-managed and restricted to the staff bags at
 * organization scope, for at most an hour. Nobody stands behind them, so the bag is the ceiling.
 */
export class StaffAccessKeyService {
  static create(options: StaffAccessKeyServiceOptions): StaffAccessKeyService {
    return new StaffAccessKeyService(options);
  }

  private constructor(private readonly options: StaffAccessKeyServiceOptions) {}

  async mint(rawInput: MintStaffAccessKeyInput): Promise<StaffAccessKeyMinted> {
    const input = mintStaffAccessKeyInputSchema.parse(rawInput);
    const bag = input.kind === "support" ? SUPPORT_BAG : READ_BAG;
    const outside = input.permissions.find((permission) => !bag.has(permission));
    if (outside !== undefined) {
      throw new ApiKeyScopeViolationError(`A staff access key may not hold ${outside}`);
    }
    const nowMs = (this.options.now ?? nowInstant)().epochMilliseconds;
    const lifetimeMs = input.expiresAt.getTime() - nowMs;
    if (lifetimeMs <= 0 || lifetimeMs > STAFF_ACCESS_KEY_MAX_LIFETIME_MS) {
      throw new ApiKeyScopeViolationError("A staff access key expires within the hour");
    }

    const { token, apiKey } = await this.options.apiKeys.create({
      isSystemManaged: true,
      name: input.kind === "support" ? STAFF_SUPPORT_KEY_NAME : STAFF_READ_KEY_NAME,
      description:
        "One-hour key an operator approved for a LangWatch staff agent. Every request it makes " +
        "is recorded, and its writes show in the audit log.",
      userId: null,
      createdByUserId: null,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: [...new Set(input.permissions)],
      bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: input.organizationId }],
      expiresAt: input.expiresAt,
    });

    return { token, apiKeyId: apiKey.id };
  }

  /** Idempotent, and silent about any key that is not a live staff access key. */
  async revoke(rawInput: RevokeStaffAccessKeyInput): Promise<void> {
    const input = revokeStaffAccessKeyInputSchema.parse(rawInput);
    const key = await this.options.repository.findById({ id: input.apiKeyId });
    if (!key || !isStaffAccessApiKey(key) || key.revokedAt) return;

    await this.options.lifecycle.revokeSystemManaged({
      id: key.id,
      organizationId: key.organizationId,
      callerUserId: null,
      cause: "user",
    });
  }
}
