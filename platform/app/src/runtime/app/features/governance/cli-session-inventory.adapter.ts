// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  DefaultGovernanceCliSessionInventoryService,
  GovernanceDiagnosticsPort,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import { RedisCliTokenStoreAdapter } from "./cli-token-revocation.adapter";

const logger = createLogger("langwatch:cli-session-inventory");
type RedisLike = Redis | Cluster;

class AppCliSessionDiagnostics extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

/** Binds Redis once and returns the canonical service contract. */
export class AppCliSessionInventoryAdapter {
  private constructor(private readonly redis?: RedisLike | null) {}

  static create(redis?: RedisLike | null): AppCliSessionInventoryAdapter {
    return new AppCliSessionInventoryAdapter(redis);
  }

  build(): DefaultGovernanceCliSessionInventoryService {
    return DefaultGovernanceCliSessionInventoryService.create({
      store: this.redis ? new RedisCliTokenStoreAdapter(this.redis) : undefined,
      diagnostics: new AppCliSessionDiagnostics(),
    });
  }
}
