import type { PresenceService } from "@langwatch/presence-contract";
import {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
  RuntimePresenceAdapter,
} from "@langwatch/presence-server";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";

class AppPresenceBroadcastPort extends PresenceBroadcastPort {
  private constructor(private readonly broadcast: BroadcastService) {
    super();
  }

  static create(broadcast: BroadcastService): AppPresenceBroadcastPort {
    return new AppPresenceBroadcastPort(broadcast);
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

class AppPresenceDiagnosticsPort extends PresenceDiagnosticsPort {
  private readonly logger = createLogger("langwatch:presence-service");

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }
}

export class AppPresenceRuntime {
  private constructor() {}

  static create(options: {
    redis: RedisConnection | null;
    broadcast: BroadcastService;
    projects: ProjectService;
  }): PresenceService {
    return RuntimePresenceAdapter.create({
      redis: options.redis,
      broadcast: AppPresenceBroadcastPort.create(options.broadcast),
      projects: options.projects,
      diagnostics: new AppPresenceDiagnosticsPort(),
    }).build();
  }
}
