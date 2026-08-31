import type { GatewayPersistenceTransaction } from "./gateway-change-events.port";

export type GatewayVirtualKeyScope = {
  scopeType: "ORGANIZATION" | "PROJECT" | "TEAM";
  scopeId: string;
};

export type ScopeInput = GatewayVirtualKeyScope;

export type GatewayVirtualKeyRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "DISABLED" | "REVOKED";
  purpose: "LANGY" | "USER";
  externalId: string | null;
  metadata: unknown;
  disabledAt: Date | null;
  disabledReason: string | null;
  expiresAt: Date | null;
  hashedSecret: string;
  displayPrefix: string;
  principalUserId: string | null;
  traceProjectId: string | null;
  config: unknown;
  revision: bigint;
  previousHashedSecret: string | null;
  previousSecretValidUntil: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  lastUsedAt: Date | null;
  routingPolicyId: string | null;
  routingMode: "FALLBACK_ALL" | "NONE" | "POLICY";
  scopes: GatewayVirtualKeyScope[];
  principalUser: { id: string; name: string | null; email: string | null } | null;
  routingPolicy: {
    id: string;
    name: string;
    modelAliases: unknown;
    defaultModel: string | null;
    policyRules: unknown;
  } | null;
};

export type VirtualKeyWithScopes = GatewayVirtualKeyRecord;

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
  expiresAt?: Date | null;
  routingPolicyId?: string | null;
  routingMode?: "FALLBACK_ALL" | "NONE" | "POLICY";
  purpose?: "LANGY" | "USER";
};

export type SetGatewayVirtualKeyDisabledInput = {
  id: string;
  organizationId: string;
  disabled: boolean;
  reason: string | null;
};

export abstract class GatewayVirtualKeysPort {
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
  abstract findPageInOrganization(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
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
      previousSecretValidUntil: Date;
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
    at: Date,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<void>;
}
