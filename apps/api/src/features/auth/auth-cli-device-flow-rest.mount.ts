/**
 * The API process's CLI device-grant door.
 *
 * Behaviour is package-owned (`@langwatch/auth-server`); this supplies the
 * five things the grant reaches that Auth does not own — the Redis the
 * ephemeral records live in, the typed client the membership is re-derived
 * from, the person a browser cookie names, the credential service the
 * user-scoped CLI key is minted through, and the personal workspace a device
 * session ships the key of.
 *
 * ## Why the store is Redis and not a repository
 *
 * Every record the grant writes is TTL'd — a device code lives ten minutes, an
 * access token an hour — and none of them is ever read by anything but its own
 * key. There is no row to query, so the port is five key operations and this
 * is the adapter for them. Single-key on purpose: a Redis cluster
 * CROSSSLOT-rejects a multi-key operation whose keys hash to different slots,
 * and the device code, its user-code index and the two token records always
 * do.
 *
 * ## What makes the family absent
 *
 * No Redis, no database, or no browser session. Each is fatal in its own way:
 * without Redis there is nowhere to put a device code, so `/device-code` would
 * hand out a code no poll could ever resolve; without the database the
 * membership re-derivation that stands between an offboarded person and a live
 * credential cannot run; and without a session the three browser routes cannot
 * name who is approving, which is the whole of what approval means. Absent
 * beats a door that answers 500 to every `langwatch login`.
 */
import {
  CliDeviceSessionService,
  CliDeviceSessionStorePort,
  type AuthCliDeviceFlowRestPorts,
  type CliBrowserSessionPort,
  type CliPersonalWorkspace,
} from "@langwatch/auth-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OrganizationApp } from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

/** The one Redis this process opened, behind the grant's five operations. */
export class ApiCliDeviceSessionStore extends CliDeviceSessionStorePort {
  static create(redis: RedisConnection): ApiCliDeviceSessionStore {
    return new ApiCliDeviceSessionStore(redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    await this.redis.set(input.key, input.value, "EX", input.ttlSeconds);
  }

  async setIfAbsent(input: {
    key: string;
    value: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    // SET NX EX in one round trip: two concurrent polls cannot both see the
    // key missing, which is what a get-then-set would allow.
    const result = await this.redis.set(
      input.key,
      input.value,
      "EX",
      input.ttlSeconds,
      "NX",
    );
    return result === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async indexTokens(input: {
    indexKey: string;
    memberKeys: string[];
    ttlMs: number;
  }): Promise<void> {
    await this.redis
      .pipeline()
      .sadd(input.indexKey, ...input.memberKeys)
      .pexpire(input.indexKey, input.ttlMs)
      .exec();
  }

  async removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    await this.redis.srem(input.indexKey, input.memberKey);
  }
}

export type ApiAuthCliDeviceFlowOptions = Readonly<{
  /** The Group Queue's Redis, or none. */
  redis: RedisConnection | null | undefined;
  /** The process's one guarded connection, or none. */
  prisma: PrismaClient | undefined;
  /** How this process turns a request into a signed-in person, or none. */
  session: ((request: Request) => Promise<{ id: string } | null>) | undefined;
  /** The SAME credential service every other door authenticates through. */
  apiKeys: ApiKeyService | undefined;
  /** The organization application the personal workspace is ensured on. */
  organizations: OrganizationApp | undefined;
  /** The AuthZ graph the project write check runs on. */
  authz: AuthzService | undefined;
  /** This deployment's flag store, for the device journey's rollout gate. */
  featureFlags: FeatureFlagService | undefined;
  /** This deployment's public origin, where it declared one. */
  publicBaseUrl: string | undefined;
  /**
   * A shorter refresh-token lifetime, where the deployment configured one.
   *
   * Undefined keeps the package default — the quarter-long idle window a
   * coding agent's owner expects to survive.
   */
  refreshTokenTtlSeconds?: number | undefined;
}>;

/**
 * Composes the device-grant ports, or none.
 *
 * The `name` and `email` a person carries come from the session port's own
 * answer where it has them; this process's port resolves only an id, so the
 * two display fields are read from the directory alongside. They name a
 * personal workspace and nothing is authorized by them.
 */
export function composeApiAuthCliDeviceFlow(
  options: ApiAuthCliDeviceFlowOptions,
): AuthCliDeviceFlowRestPorts | undefined {
  const { redis, prisma, session, apiKeys, organizations, authz, featureFlags } = options;
  if (!redis || !prisma || !session || !apiKeys || !organizations || !authz || !featureFlags) {
    return undefined;
  }

  const resolveSession: CliBrowserSessionPort = async (request) => {
    const actor = await session(request);
    if (!actor) return null;
    const person = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true, email: true },
    });
    return { id: actor.id, name: person?.name, email: person?.email };
  };

  const ensurePersonalWorkspace = async (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<CliPersonalWorkspace> =>
    (await organizations.ensurePersonalWorkspace(
      {
        organizationId: input.organizationId,
        displayName: input.displayName,
        displayEmail: input.displayEmail,
      },
      { id: input.userId },
    )) as CliPersonalWorkspace;

  return {
    sessions: CliDeviceSessionService.create({
      store: ApiCliDeviceSessionStore.create(redis),
      refreshTokenTtlSeconds: options.refreshTokenTtlSeconds,
    }),
    database: () => prisma,
    session: resolveSession,
    apiKeys: () => apiKeys,
    ensurePersonalWorkspace,
    canWriteProject: ({ userId, projectId }) =>
      authz.hasPermission({ userId, permission: "project:update", projectId }),
    featureFlags: () => featureFlags,
    ...(options.publicBaseUrl ? { publicBaseUrl: options.publicBaseUrl } : {}),
  };
}
