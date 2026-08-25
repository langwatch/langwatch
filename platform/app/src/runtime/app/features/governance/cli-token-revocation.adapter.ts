// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  CliTokenStorePort,
  DefaultGovernanceCliTokenRevocationService,
  GovernanceDiagnosticsPort,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";

const logger = createLogger("langwatch:cli-token-revocation");
type RedisLike = Redis | Cluster;

export class RedisCliTokenStoreAdapter extends CliTokenStorePort {
  constructor(private readonly redis: RedisLike) {
    super();
  }

  members(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  delete(key: string): Promise<number> {
    return this.redis.del(key);
  }

  removeMembers(key: string, members: string[]): Promise<number> {
    return members.length > 0 ? this.redis.srem(key, ...members) : Promise.resolve(0);
  }
}

class AppCliTokenDiagnostics extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

/** Binds Redis once and returns the canonical service contract. */
export class AppCliTokenRevocationAdapter {
  private constructor(private readonly redis?: RedisLike | null) {}

  static create(redis?: RedisLike | null): AppCliTokenRevocationAdapter {
    return new AppCliTokenRevocationAdapter(redis);
  }

  build(): DefaultGovernanceCliTokenRevocationService {
    return DefaultGovernanceCliTokenRevocationService.create({
      store: this.redis ? new RedisCliTokenStoreAdapter(this.redis) : undefined,
      diagnostics: new AppCliTokenDiagnostics(),
    });
  }
}
