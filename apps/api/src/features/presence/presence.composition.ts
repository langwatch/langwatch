/**
 * `presence.*` — who else is looking at this project, and where their cursor is —
 * composed as its own feature, together with the tenant fan-out it publishes on. The
 * fabric is the load-bearing half.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PresenceService } from "@langwatch/presence-contract";
import {
  BroadcastAdapter,
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  type PresenceEmitterPort,
  RuntimePresenceAdapter,
} from "@langwatch/presence-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import type { ApiTrpcFeatureMount } from "../../api.application";
import { createPresenceTrpcRouter } from "./presence-trpc.mount";

/** The one namespace this feature mounts, and the two slices behind it. */
export type ComposedPresenceFeature = Readonly<{
  /** The `ctx.app.presence` slice. */
  app: PresenceService;
  /** The `ctx.app.broadcast` slice, which the export relay reads too. */
  emitter: PresenceEmitterPort;
  /**
   * The fan-out itself, for the REST families and the three subscription surfaces that
   * broadcast on it. Absent on a process that composed no presence graph, so each of them
   * refuses by name rather than publishing into a fabric nobody subscribed to.
   */
  broadcast: BroadcastAdapter | undefined;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPresenceTrpcRouter>;
}>;

/** Composes presence and the fabric it publishes on. */
export function composePresenceFeature(options: {
  /** The process's Redis, where it has one. Presence and the fan-out use it. */
  redis: RedisConnection | null;
  /** The project directory a cursor's scope is resolved against. */
  projects: ProjectService;
  /** The process's shutdown scope; see this module's docblock. */
  resources: { own(name: string, close: () => Promise<void>): void };
}): ComposedPresenceFeature {
  const logger = createLogger("langwatch:api:presence");
  const broadcast = BroadcastAdapter.create(options.redis ?? null);
  options.resources.own("API presence broadcast", () => broadcast.close());

  const app: PresenceService = RuntimePresenceAdapter.create({
    redis: options.redis,
    broadcast: ApiPresenceBroadcast.create(broadcast),
    projects: options.projects,
    diagnostics: ApiPresenceDiagnostics.create(logger),
  }).build();

  return {
    app,
    emitter: broadcast as unknown as PresenceEmitterPort,
    broadcast,
    router: (mount) => createPresenceTrpcRouter(mount),
  };
}

/**
 * Presence on a process that composed no graph to answer it. The namespace still mounts
 * and every call refuses by name, so a person is told the deployment cannot report who
 * else is here rather than shown an empty room they are in fact sharing.
 */
export function refusingPresenceFeature(): ComposedPresenceFeature {
  const refuse = (): never => {
    throw new ApiPresenceUnavailableError("presence graph");
  };
  const refusing = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refusing<PresenceService>(),
    emitter: refusing<PresenceEmitterPort>(),
    broadcast: undefined,
    router: (mount) => createPresenceTrpcRouter(mount),
  };
}

/** The presence publisher, over the process's broadcast fabric. */
class ApiPresenceBroadcast extends PresenceBroadcastPort {
  static create(broadcast: BroadcastAdapter): ApiPresenceBroadcast {
    return new ApiPresenceBroadcast(broadcast);
  }

  private constructor(private readonly broadcast: BroadcastAdapter) {
    super();
  }

  async publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void> {
    if (input.rateLimited) {
      await this.broadcast.broadcastToTenantRateLimited(
        input.projectId,
        input.event,
        input.channel,
        "delta",
      );
      return;
    }
    await this.broadcast.broadcastToTenant(input.projectId, input.event, input.channel);
  }
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

/** A capability this deployment did not compose, refused by name. */
export class ApiPresenceUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiPresenceUnavailableError";
  }
}
