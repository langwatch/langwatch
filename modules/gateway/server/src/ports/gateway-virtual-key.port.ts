import type { Instant } from "@langwatch/time";

/** Shared projection required whenever a virtual key materialises routing policy. */
export const gatewayRoutingPolicySelect = {
  id: true,
  name: true,
  modelAliases: true,
  defaultModel: true,
  policyRules: true,
} as const;

import type {
  GatewayVirtualKeyRecord,
  GatewayVirtualKeyScope,
  ResourceMetadata,
} from "@langwatch/gateway-contract";
import type { GatewayPersistenceTransaction } from "../app/gateway.members.ts";


export type CreateGatewayVirtualKeyInput = {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId?: string | null;
  config: unknown;
  externalId?: string | null;
  metadata?: unknown;
  createdById: string;
  scopes: GatewayVirtualKeyScope[];
  traceProjectId?: string | null;
  expiresAt?: Instant | null;
  routingPolicyId?: string | null;
  routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
  purpose?: "LANGY" | "USER";
};

/**
 * The columns an edit writes. `externalId` and `metadata` fold absent and
 * null apart: an absent key leaves the stored value alone, an explicit null
 * clears it, so the two cannot be collapsed into one optional.
 */
export type UpdateGatewayVirtualKeyInput = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  config: unknown;
  externalId?: string | null;
  metadata?: ResourceMetadata;
  routingPolicyId?: string | null;
  expiresAt?: Instant | null;
  traceProjectId: string;
  routingMode: "FALLBACK_ALL" | "NONE" | "POLICY";
};

export type SetGatewayVirtualKeyDisabledInput = {
  id: string;
  organizationId: string;
  disabled: boolean;
  reason: string | null;
};

export abstract class GatewayVirtualKeys {
  abstract tryFindById(
    input: { id: string; organizationId: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord | null>;
  abstract tryFindByIdGlobal(
    id: string,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord | null>;
  abstract tryFindByHashedSecret(
    hashedSecret: string,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord | null>;
  /**
   * Just name and prefix, for keys the caller already has ids for (usage surfaces label ledger rows). Scoped to the organization even though ids alone would find the rows — a read answerable within only one tenant can't be made to leak by a caller's id list from somewhere unexpected.
   */
  abstract findMetaByIds(input: {
    organizationId: string;
    ids: string[];
  }): Promise<Array<{ id: string; name: string; displayPrefix: string }>>;
  abstract findPageInOrganization(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    externalId?: string;
  }): Promise<GatewayVirtualKeyRecord[]>;
  abstract findAllInOrganization(
    organizationId: string,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord[]>;
  abstract findAllForScope(
    scope: GatewayVirtualKeyScope,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord[]>;
  abstract create(
    input: CreateGatewayVirtualKeyInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord>;
  /** Applies an edit and bumps the revision the gateway long-polls on. */
  abstract update(
    input: UpdateGatewayVirtualKeyInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord>;
  /**
   * The organization a routing policy belongs to, for the check that a key
   * may only name one of its own. Null when no such policy exists.
   */
  abstract tryFindRoutingPolicyOwner(input: {
    routingPolicyId: string;
  }): Promise<{ organizationId: string } | null>;
  abstract replaceScopes(
    id: string,
    scopes: GatewayVirtualKeyScope[],
    transaction?: GatewayPersistenceTransaction,
  ): Promise<void>;
  /**
   * Named rather than positional on purpose: `newHashedSecret` and
   * `previousHashedSecret` are both strings, and transposing them at a call
   * site compiles — leaving the retired secret as the live one.
   */
  abstract rotateSecret(
    input: {
      id: string;
      organizationId: string;
      newHashedSecret: string;
      newDisplayPrefix: string;
      previousHashedSecret: string;
      previousSecretValidUntil: Instant;
    },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord>;
  abstract revoke(
    input: { id: string; organizationId: string; revokedById: string },
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord>;
  abstract setDisabled(
    input: SetGatewayVirtualKeyDisabledInput,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<GatewayVirtualKeyRecord>;
  abstract recordUsage(
    id: string,
    at: Instant,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<void>;
}
