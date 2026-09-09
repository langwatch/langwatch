/**
 * The worker's person graph.
 *
 * Annotation processing needs the same user directory and browser-session
 * lifecycle as the API.  The directory is built once, because Auth resolves
 * users through it and UserApp exposes the same instance to its callers.
 * Ops is supplied as a complete capability assembled by the worker root and
 * wrapped in its canonical application so UserApp receives an actual OpsApi.
 */
import { authServer, AuthUnavailableError, type AuthInfrastructure } from "@langwatch/auth-server";
import {
  BetterAuthAccountQueriesAdapter,
  PostgresIdentityEmailAdapter,
} from "@langwatch/identity-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ApplicationBuilder } from "@langwatch/runtime-composition";
import {
  userServer,
  type UserAvatarStorage,
  type UserInfrastructure,
} from "@langwatch/user-server";
import {
  USER_AVATAR_MAX_BYTES,
  USER_AVATAR_OWNER_KIND,
  USER_AVATAR_PURPOSE,
  UserAvatarTooLargeError,
  type UserAvatarMediaType,
} from "@langwatch/user-contract";
import type { StoredObjectsService } from "@langwatch/stored-object-server";

/** A worker does not own the avatar upload transport or object store. */
export class WorkerUserAvatarStorage implements UserAvatarStorage {
  static create(
    storedObjects: Pick<StoredObjectsService, "storeFromBytes">,
  ): WorkerUserAvatarStorage {
    return new WorkerUserAvatarStorage(storedObjects);
  }

  private constructor(
    private readonly storedObjects: Pick<StoredObjectsService, "storeFromBytes">,
  ) {}

  store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    if (input.bytes.byteLength > USER_AVATAR_MAX_BYTES) throw new UserAvatarTooLargeError();
    return this.storedObjects
      .storeFromBytes({
        projectId: input.projectId,
        purpose: USER_AVATAR_PURPOSE,
        ownerKind: USER_AVATAR_OWNER_KIND,
        ownerId: input.userId,
        mediaType: input.mediaType,
        bytes: Buffer.from(input.bytes),
      })
      .then(({ id }) => ({ id }));
  }
}

/**
 * What the worker holds behind the auth module.
 *
 * It serves no signed-out door, so the front door's collaborators are absent
 * and every one of its operations refuses by name rather than answering: a
 * throttle that answered "allowed" on a process with no counter, or a sign-in
 * router that answered "email" without reading a connection, would be a wrong
 * answer rather than a missing one.
 */
function workerAuthInfrastructure(options: WorkerUserCompositionOptions): AuthInfrastructure {
  const unreachable = (capability: string) =>
    new AuthUnavailableError({ capability, processName: "langwatch-worker" });

  return {
    redis: options.redis ?? null,
    identityEmails: PostgresIdentityEmailAdapter.create({
      database: options.connection.client,
    }).build(),
    rateLimit: () => Promise.reject(unreachable("front-door counter")),
    route: () => Promise.reject(unreachable("sign-in router")),
    signUp: null,
    invites: null,
    authProvider: () => Promise.reject(unreachable("sign-in mode")),
    processName: "langwatch-worker",
  };
}

export type WorkerUserCompositionOptions = Readonly<{
  connection: PrismaConnection;
  redis?: RedisConnection | null;
  credentialIssuer?: string;
  avatarStorage: UserAvatarStorage;
}>;

/**
 * A worker composes no browser, no mail and no governance stores, so every
 * account-facing member of the user record refuses by name; the worker only
 * creates and reads people.
 */
function workerUserInfrastructure(options: WorkerUserCompositionOptions): UserInfrastructure {
  const refusing = <T>(capability: string): T =>
    new Proxy(
      {},
      {
        get: () => (): never => {
          throw new Error(`The worker composed no ${capability}, so it cannot serve this call.`);
        },
        has: () => true,
      },
    ) as T;

  return {
    credentialIssuer:
      options.credentialIssuer ?? BetterAuthAccountQueriesAdapter.issuerForProviderId("credential"),
    avatarStorage: options.avatarStorage,
    avatarObjects: refusing("avatar object store"),
    passwords: refusing("password hasher"),
    deployment: refusing("deployment facts"),
    rateLimit: refusing("rate limiter"),
    analytics: refusing("analytics sink"),
    federatedPasswords: refusing("federated password store"),
    cliCredentials: refusing("CLI credential store"),
    organizations: refusing("organization directory"),
    projects: refusing("project directory"),
    gateway: refusing("gateway governance"),
    budgetRequests: refusing("budget request mailer"),
    verification: refusing("verification ceremony"),
    personalUsage: refusing("personal usage reader"),
  };
}

/** Declare the cyclic User/Auth pair on the shared runtime builder. */
export function installWorkerUser<Infrastructure>(
  builder: ApplicationBuilder<Infrastructure>,
  options: WorkerUserCompositionOptions,
): ApplicationBuilder<Infrastructure> {
  return builder
    .withModule(authServer, { infrastructure: workerAuthInfrastructure(options) })
    .withModule(userServer, { infrastructure: workerUserInfrastructure(options) });
}
