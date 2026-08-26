// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import { RedisCliTokenStoreAdapter } from "./cli-token-revocation.adapter";

const logger = createLogger("langwatch:cli-session-inventory");
type RedisLike = Redis | Cluster;

class AppCliSessionDiagnostics {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

/** Binds the process Redis client to the server installation token-store port. */
export class AppCliSessionInventoryAdapter {
  private constructor(private readonly redis?: RedisLike | null) {}

  static create(redis?: RedisLike | null): AppCliSessionInventoryAdapter {
    return new AppCliSessionInventoryAdapter(redis);
  }

  tokenStore(): RedisCliTokenStoreAdapter | undefined {
    return this.redis ? new RedisCliTokenStoreAdapter(this.redis) : undefined;
  }

  diagnostics(): AppCliSessionDiagnostics {
    return new AppCliSessionDiagnostics();
  }
}
