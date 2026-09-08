/**
 * `presence.*` — who else is looking at this project, and where their cursor is —
 * installed over this process's own graph. The tenant fan-out it publishes on is
 * the PROCESS's: three other halves ride the same one, so the process creates it
 * and hands it here rather than this install owning a second.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import {
  type BroadcastAdapter,
  PresenceDiagnosticsPort,
  presenceServer,
  type PresenceInfrastructure,
} from "@langwatch/presence-server";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import { createPresenceTrpcRouter } from "./presence-trpc.mount.ts";
import type { ComposedPresenceFeature } from "./presence.composition.types.ts";

/** The other features' directories the presence surface reads. */
export type PresencePeers = Readonly<{
  projects: ProjectApiContract;
  users: UserApiContract;
}>;

/** Installs presence over the tenant fan-out this process already owns. */
export async function installApiPresence(options: {
  /**
   * The process's ONE fan-out, started and drained by whoever created it. Both
   * the publish and the subscribe side are this object.
   */
  broadcast: BroadcastAdapter;
  /** The process's Redis, where it has one: where a session is kept. */
  redis: RedisConnection | null;
  peers: PresencePeers;
}): Promise<ComposedPresenceFeature> {
  const { broadcast } = options;
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
