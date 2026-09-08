/**
 * `presence.*` — who else is looking at this project, and where their cursor is —
 * installed over this process's own graph, together with the tenant fan-out it
 * publishes on. The fabric is the load-bearing half.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import {
  BroadcastAdapter,
  PresenceDiagnosticsPort,
  presenceServer,
  type PresenceInfrastructure,
} from "@langwatch/presence-server";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp, type ResourceOwnership } from "@langwatch/runtime-composition";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import { createPresenceTrpcRouter } from "./presence-trpc.mount.ts";
import type { ComposedPresenceFeature } from "./presence.composition.types.ts";

/** The other features' directories the presence surface reads. */
export type PresencePeers = Readonly<{
  projects: ProjectApiContract;
  users: UserApiContract;
}>;

/** Installs presence and the fabric it publishes on. */
export async function installApiPresence(options: {
  /** The process's Redis, where it has one. Presence and the fan-out use it. */
  redis: RedisConnection | null;
  peers: PresencePeers;
  /** The process's shutdown scope; the fabric is started and drained with it. */
  resources: ResourceOwnership;
}): Promise<ComposedPresenceFeature> {
  const broadcast = BroadcastAdapter.create(options.redis);
  options.resources.own("API presence broadcast", () => broadcast.close());
  options.resources.ownService({
    name: "API presence broadcast",
    start: () => broadcast.start(),
    stop: () => broadcast.close(),
  });

  const infrastructure: PresenceInfrastructure = {
    broadcast,
    emitters: broadcast,
    diagnostics: ApiPresenceDiagnostics.create(createLogger("langwatch:api:presence")),
  };

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence(
      options.redis ? "redis" : "memory",
      options.redis ? { redis: options.redis } : {},
    )
    .withInfrastructure(infrastructure)
    .withProvided(ProjectApi, options.peers.projects)
    .withProvided(UserApi, options.peers.users)
    .withFeature(presenceServer)
    .boot({ role: "api" });

  return {
    app: runtime.feature(presenceServer).provided,
    emitter: broadcast,
    broadcast,
    router: (mount) => createPresenceTrpcRouter(mount.runtime),
  };
}

/** Presence diagnostics on this process's structured logger. */
class ApiPresenceDiagnostics extends PresenceDiagnosticsPort {
  static create(logger: Pick<Logger, "warn">): ApiPresenceDiagnostics {
    return new ApiPresenceDiagnostics(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}
