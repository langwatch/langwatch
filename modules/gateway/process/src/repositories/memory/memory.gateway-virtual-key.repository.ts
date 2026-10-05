import {
  identityPatchData,
  type GatewayVirtualKeyRecord,
  type GatewayVirtualKeyScope,
} from "@langwatch/gateway-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import {
  GatewayVirtualKeyRepository,
  type CreateGatewayVirtualKeyInput,
  type GatewayLicensedKey,
  type SetGatewayVirtualKeyDisabledInput,
  type UpdateGatewayVirtualKeyInput,
} from "../gateway-virtual-key.repository.ts";
import {
  memoryKeysetAfter,
  memoryKeysetCompare,
  MemoryGatewayRowNotFoundError,
  MemoryGatewayUniqueConflictError,
  type MemoryGatewayStore,
} from "./memory.gateway.store.ts";

/** Virtual keys over the shared key rows, joined to the seeded principals and routing policies. */
export class MemoryGatewayVirtualKeyRepository extends GatewayVirtualKeyRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayVirtualKeyRepository {
    return new MemoryGatewayVirtualKeyRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayVirtualKeyRecord | null> {
    const key = this.store.virtualKeys.get(input.id);
    return key?.organizationId === input.organizationId ? this.#joined(key) : null;
  }

  async findByIdGlobal(id: string): Promise<GatewayVirtualKeyRecord | null> {
    const key = this.store.virtualKeys.get(id);
    return key ? this.#joined(key) : null;
  }

  async findByHashedSecret(hashedSecret: string): Promise<GatewayVirtualKeyRecord | null> {
    const now = nowInstant();
    const key = this.#keys().find(
      (row) =>
        row.hashedSecret === hashedSecret ||
        (row.previousHashedSecret === hashedSecret &&
          row.previousSecretValidUntil !== null &&
          Temporal.Instant.compare(row.previousSecretValidUntil, now) > 0),
    );
    return key ? this.#joined(key) : null;
  }

  async findMetaByIds(input: {
    organizationId: string;
    ids: string[];
  }): Promise<{ id: string; name: string; displayPrefix: string }[]> {
    const ids = new Set(input.ids);
    return this.#keys()
      .filter((key) => key.organizationId === input.organizationId && ids.has(key.id))
      .map(({ id, name, displayPrefix }) => ({ id, name, displayPrefix }));
  }

  async findPageInOrganization(input: {
    organizationId: string;
    limit: number;
    cursor: { createdAt: Instant; id: string } | null;
    externalId?: string;
  }): Promise<GatewayVirtualKeyRecord[]> {
    const { cursor } = input;
    return this.#keys()
      .filter(
        (key) =>
          key.organizationId === input.organizationId &&
          key.purpose === "USER" &&
          (input.externalId === undefined || key.externalId === input.externalId) &&
          (cursor === null || memoryKeysetAfter(newestFirst(key), [cursor.createdAt, cursor.id])),
      )
      .toSorted((left, right) => memoryKeysetCompare(newestFirst(left), newestFirst(right)))
      .slice(0, input.limit)
      .map((key) => this.#joined(key));
  }

  async findAllInOrganization(organizationId: string): Promise<GatewayVirtualKeyRecord[]> {
    return this.#newestFirst(
      (key) => key.organizationId === organizationId && key.purpose === "USER",
    );
  }

  async findLiveWithPrincipal(input: {
    organizationId?: string;
    principalUserId?: string;
  }): Promise<GatewayVirtualKeyRecord[]> {
    return this.#newestFirst(
      (key) =>
        (input.organizationId === undefined || key.organizationId === input.organizationId) &&
        (input.principalUserId === undefined
          ? key.principalUserId !== null
          : key.principalUserId === input.principalUserId) &&
        key.revokedAt === null,
    );
  }

  async findAllForScope(scope: GatewayVirtualKeyScope): Promise<GatewayVirtualKeyRecord[]> {
    return this.#newestFirst(
      (key) =>
        key.purpose === "USER" &&
        key.scopes.some(
          (entry) => entry.scopeType === scope.scopeType && entry.scopeId === scope.scopeId,
        ),
    );
  }

  async create(input: CreateGatewayVirtualKeyInput): Promise<GatewayVirtualKeyRecord> {
    if (this.store.virtualKeys.has(input.id)) throw new MemoryGatewayUniqueConflictError(["id"]);
    this.#assertUnique({
      id: input.id,
      organizationId: input.organizationId,
      externalId: input.externalId ?? null,
      hashedSecret: input.hashedSecret,
    });
    const now = nowInstant();
    const key: GatewayVirtualKeyRecord = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      status: "ACTIVE",
      purpose: input.purpose ?? "USER",
      externalId: input.externalId ?? null,
      metadata: input.metadata === undefined ? {} : structuredClone(input.metadata),
      disabledAt: null,
      disabledReason: null,
      expiresAt: input.expiresAt ?? null,
      hashedSecret: input.hashedSecret,
      displayPrefix: input.displayPrefix,
      principalUserId: input.principalUserId ?? null,
      traceProjectId: input.traceProjectId ?? null,
      config: structuredClone(input.config),
      revision: 1n,
      previousHashedSecret: null,
      previousSecretValidUntil: null,
      revokedAt: null,
      revokedById: null,
      createdAt: now,
      updatedAt: now,
      createdById: input.createdById,
      lastUsedAt: null,
      routingPolicyId: input.routingPolicyId ?? null,
      routingMode: input.routingMode ?? "NONE",
      scopes: input.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      principalUser: null,
      routingPolicy: null,
    };
    this.store.virtualKeys.set(key.id, key);
    this.store.connectColumns.set(key.id, {
      connectServices: [],
      licenseTokenHash: null,
      licenseInstanceId: null,
      licenseExpiresAt: null,
    });

    return this.#joined(key);
  }

  async update(input: UpdateGatewayVirtualKeyInput): Promise<GatewayVirtualKeyRecord> {
    const patch = identityPatchData(input);
    if (patch.externalId !== undefined) {
      this.#assertUnique({
        id: input.id,
        organizationId: input.organizationId,
        externalId: patch.externalId,
        hashedSecret: null,
      });
    }

    return this.#replace(input, (key) => ({
      name: input.name,
      description: input.description,
      config: structuredClone(input.config),
      ...patch,
      ...(input.routingPolicyId === undefined ? {} : { routingPolicyId: input.routingPolicyId }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      traceProjectId: input.traceProjectId,
      routingMode: input.routingMode,
      revision: key.revision + 1n,
    }));
  }

  async findRoutingPolicyOwner(input: {
    routingPolicyId: string;
  }): Promise<{ organizationId: string } | null> {
    const policy = this.store.routingPolicies.find((row) => row.id === input.routingPolicyId);
    return policy ? { organizationId: policy.organizationId } : null;
  }

  async replaceScopes(id: string, scopes: GatewayVirtualKeyScope[]): Promise<void> {
    const key = this.store.virtualKeys.get(id);
    if (!key) return;
    this.store.virtualKeys.set(id, {
      ...key,
      scopes: scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
    });
  }

  async rotateSecret(input: {
    id: string;
    organizationId: string;
    newHashedSecret: string;
    newDisplayPrefix: string;
    previousHashedSecret: string;
    previousSecretValidUntil: Instant;
  }): Promise<GatewayVirtualKeyRecord> {
    this.#assertUnique({
      id: input.id,
      organizationId: input.organizationId,
      externalId: null,
      hashedSecret: input.newHashedSecret,
    });

    return this.#replace(input, (key) => ({
      hashedSecret: input.newHashedSecret,
      displayPrefix: input.newDisplayPrefix,
      previousHashedSecret: input.previousHashedSecret,
      previousSecretValidUntil: input.previousSecretValidUntil,
      revision: key.revision + 1n,
    }));
  }

  async revoke(input: {
    id: string;
    organizationId: string;
    revokedById: string;
  }): Promise<GatewayVirtualKeyRecord> {
    return this.#replace(input, (key) => ({
      status: "REVOKED",
      revokedAt: nowInstant(),
      revokedById: input.revokedById,
      previousHashedSecret: null,
      previousSecretValidUntil: null,
      revision: key.revision + 1n,
    }));
  }

  async setDisabled(input: SetGatewayVirtualKeyDisabledInput): Promise<GatewayVirtualKeyRecord> {
    // Rotation grace is left alone both ways: a key re-enabled mid-grace keeps its old secret.
    return this.#replace(input, (key) =>
      input.disabled
        ? {
            status: "DISABLED",
            disabledAt: nowInstant(),
            disabledReason: input.reason,
            revision: key.revision + 1n,
          }
        : { status: "ACTIVE", disabledAt: null, disabledReason: null, revision: key.revision + 1n },
    );
  }

  async setConnectServices(input: {
    id: string;
    organizationId: string;
    services: readonly string[];
  }): Promise<boolean> {
    return this.#updateConnect(input, { connectServices: [...input.services] });
  }

  async setLicenseFacts(input: {
    id: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant | null;
  }): Promise<boolean> {
    const holder = [...this.store.connectColumns].find(
      ([id, columns]) => id !== input.id && columns.licenseTokenHash === input.tokenHash,
    );
    if (holder) throw new MemoryGatewayUniqueConflictError(["licenseTokenHash"]);

    return this.#updateConnect(input, {
      licenseTokenHash: input.tokenHash,
      licenseInstanceId: input.instanceId,
      licenseExpiresAt: input.expiresAt,
    });
  }

  async findByLicenseTokenHash(tokenHash: string): Promise<GatewayLicensedKey | null> {
    const match = [...this.store.connectColumns].find(
      ([, columns]) => columns.licenseTokenHash === tokenHash,
    );
    const key = match ? this.store.virtualKeys.get(match[0]) : undefined;
    if (!match || key?.purpose !== "CONNECT") return null;

    return {
      key: this.#joined(key),
      instanceId: match[1].licenseInstanceId,
      expiresAt: match[1].licenseExpiresAt,
      services: [...match[1].connectServices],
    };
  }

  async recordUsage(id: string, at: Instant): Promise<void> {
    const key = this.store.virtualKeys.get(id);
    if (!key) throw new MemoryGatewayRowNotFoundError("virtual key", id);
    this.store.virtualKeys.set(id, { ...key, lastUsedAt: at, updatedAt: nowInstant() });
  }

  #keys(): GatewayVirtualKeyRecord[] {
    return [...this.store.virtualKeys.values()];
  }

  #newestFirst(keep: (key: GatewayVirtualKeyRecord) => boolean): GatewayVirtualKeyRecord[] {
    return this.#keys()
      .filter(keep)
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt))
      .map((key) => this.#joined(key));
  }

  /** The two joins every live read includes, answered from the seeded rows. */
  #joined(key: GatewayVirtualKeyRecord): GatewayVirtualKeyRecord {
    const user = this.store.users.find((row) => row.id === key.principalUserId);
    const policy = this.store.routingPolicies.find((row) => row.id === key.routingPolicyId);
    return {
      ...key,
      scopes: key.scopes.map((scope) => ({ ...scope })),
      principalUser: user ? { id: user.id, name: user.name, email: user.email } : null,
      routingPolicy: policy
        ? {
            id: policy.id,
            name: policy.name,
            modelAliases: policy.modelAliases,
            defaultModel: policy.defaultModel,
            policyRules: policy.policyRules,
          }
        : null,
    };
  }

  #replace(
    target: { id: string; organizationId: string },
    changes: (key: GatewayVirtualKeyRecord) => Partial<GatewayVirtualKeyRecord>,
  ): GatewayVirtualKeyRecord {
    const key = this.store.virtualKeys.get(target.id);
    if (key?.organizationId !== target.organizationId) {
      throw new MemoryGatewayRowNotFoundError("virtual key", target.id);
    }
    const next = { ...key, ...changes(key), updatedAt: nowInstant() };
    this.store.virtualKeys.set(key.id, next);

    return this.#joined(next);
  }

  #updateConnect(
    target: { id: string; organizationId: string },
    changes: Partial<{
      connectServices: string[];
      licenseTokenHash: string | null;
      licenseInstanceId: string | null;
      licenseExpiresAt: Instant | null;
    }>,
  ): boolean {
    const key = this.store.virtualKeys.get(target.id);
    const columns = this.store.connectColumns.get(target.id);
    if (key?.organizationId !== target.organizationId || key.purpose !== "CONNECT" || !columns) {
      return false;
    }
    this.store.connectColumns.set(key.id, { ...columns, ...changes });
    this.store.virtualKeys.set(key.id, {
      ...key,
      revision: key.revision + 1n,
      updatedAt: nowInstant(),
    });

    return true;
  }

  /** The table's unique indexes: the id, the secret, and the external id within an organization. */
  #assertUnique(row: {
    id: string;
    organizationId: string;
    externalId: string | null;
    hashedSecret: string | null;
  }): void {
    for (const key of this.#keys()) {
      if (key.id === row.id) continue;
      if (row.hashedSecret !== null && key.hashedSecret === row.hashedSecret) {
        throw new MemoryGatewayUniqueConflictError(["hashedSecret"]);
      }
      if (
        row.externalId !== null &&
        key.organizationId === row.organizationId &&
        key.externalId === row.externalId
      ) {
        throw new MemoryGatewayUniqueConflictError(["organizationId", "externalId"]);
      }
    }
  }
}

function newestFirst(key: GatewayVirtualKeyRecord) {
  return [
    { value: key.createdAt, direction: "desc" },
    { value: key.id, direction: "desc" },
  ] as const;
}
