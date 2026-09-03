import type { LangySessionKeyMetricsPort } from "../ports/langy-session-key-metrics.port";
import {
  PrismaLangySessionKeyReapRepository,
  type PrismaLangySessionKeyReapDatabase,
} from "../repositories/prisma/prisma.langy-session-key-reap.repository";
import { LangySessionKeyReapService } from "../services/langy-session-key-reap.service";

/**
 * The process's Prisma client, as the sweep receives it.
 *
 * The repository's own database shape under the name a composition root reads:
 * one model, `apiKey`, because that is the only table the reaper touches.
 */
export type LangySessionKeyReapDatabase = PrismaLangySessionKeyReapDatabase;

/**
 * Postgres composition for the session-key sweep.
 *
 * The composition root passes its typed client straight through to the
 * repository; nothing above this adapter knows a repository exists, and nothing
 * below it needs an untyped seam. `PostgresLangyAdapter` composes the same
 * sweep plus the eight-model conversation graph, an API-key service and an
 * AuthZ service — none of which the sweep reads — so a process that wants only
 * the reaper gets it here.
 */
export class PostgresLangySessionKeyReapAdapter {
  static create(options: {
    database: LangySessionKeyReapDatabase;
    metrics: LangySessionKeyMetricsPort;
    now?: () => Date;
  }): PostgresLangySessionKeyReapAdapter {
    return new PostgresLangySessionKeyReapAdapter(options);
  }

  private constructor(
    private readonly options: {
      database: LangySessionKeyReapDatabase;
      metrics: LangySessionKeyMetricsPort;
      now?: () => Date;
    },
  ) {}

  build(): LangySessionKeyReapService {
    return LangySessionKeyReapService.create({
      repository: PrismaLangySessionKeyReapRepository.create(this.options.database),
      metrics: this.options.metrics,
      ...(this.options.now ? { now: this.options.now } : {}),
    });
  }
}
