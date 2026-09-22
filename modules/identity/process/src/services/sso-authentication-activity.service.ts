import { createLogger } from "@langwatch/observability";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type { SsoMigrationEvidenceRepository } from "../repositories/sso-migration-evidence.repository.ts";

const logger = createLogger("langwatch:identity:sso-activity");

export interface SsoAuthenticationActivityServiceDeps {
  connections: SsoConnectionReadRepository;
  activity: SsoMigrationEvidenceRepository;
  now?: () => number;
}

/**
 * The trail a connection's sign-ins leave: what proves a test sign-in
 * happened, and what the quiet period before a migration is finalized is
 * measured from. A provider that names no connection leaves none.
 */
export class SsoAuthenticationActivityService {
  static create(deps: SsoAuthenticationActivityServiceDeps): SsoAuthenticationActivityService {
    return new SsoAuthenticationActivityService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoAuthenticationActivityServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Total and silent: the session already exists, so a trail that cannot be
   * written is reported rather than turned into a refused sign-in.
   */
  async record({ connectionId, userId }: { connectionId: string; userId: string }): Promise<void> {
    try {
      const connection = await this.deps.connections.tryFindConnection({ connectionId });
      if (!connection) return;

      await this.deps.activity.recordAuthentication({
        organizationId: connection.organizationId,
        connectionId,
        userId,
        authenticatedAtMs: this.now(),
      });
    } catch (error) {
      logger.error(
        { error, connectionId, userId },
        "a sign-in through a single sign-on connection was not recorded (the sign-in itself stands)",
      );
    }
  }
}
