import type { PresenceService as PresenceServiceContract } from "@langwatch/presence-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { PresenceBroadcastPort, PresenceDiagnosticsPort } from "../ports/presence.port.ts";
import { MemoryPresenceRepository } from "../repositories/memory/memory.presence.repository.ts";
import { RedisPresenceRepository } from "../repositories/redis/redis.presence.repository.ts";
import { PresenceService } from "../services/presence.service.ts";

export interface RuntimePresenceAdapterOptions {
  redis: RedisConnection | null;
  broadcast: PresenceBroadcastPort;
  projects: ProjectService;
  diagnostics?: PresenceDiagnosticsPort;
  ttlSeconds?: number;
  now?: () => number;
}

export class RuntimePresenceAdapter {
  private constructor(private readonly options: RuntimePresenceAdapterOptions) {}

  static create(options: RuntimePresenceAdapterOptions): RuntimePresenceAdapter {
    return new RuntimePresenceAdapter(options);
  }

  build(): PresenceServiceContract {
    return PresenceService.create({
      repository: this.options.redis
        ? RedisPresenceRepository.create(this.options.redis)
        : MemoryPresenceRepository.create({ now: this.options.now }),
      broadcast: this.options.broadcast,
      projects: this.options.projects,
      diagnostics: this.options.diagnostics,
      ttlSeconds: this.options.ttlSeconds,
      now: this.options.now,
    });
  }
}
