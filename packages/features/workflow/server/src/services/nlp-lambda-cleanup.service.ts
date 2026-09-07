/**
 * Sweeps the studio's quiet per-project NLP Lambda functions and orphaned log
 * groups. A function silent for a week is deleted, a log group silent for a
 * year with it; one whose activity cannot be READ is left alone.
 */
import type { Logger } from "@langwatch/observability";
import { Temporal, nowInstant, type Instant } from "@langwatch/time";
import { NlpLambdaFleetPort } from "../ports/nlp-lambda-fleet.port.ts";
import { NLP_LAMBDA_NAME_PREFIX } from "../rules/nlp-lambda-config.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const FUNCTION_IDLE_DAYS = 7;
const LOG_GROUP_IDLE_DAYS = 365;

export type NlpLambdaCleanupReport = Readonly<{
  functionsDeleted: number;
  logGroupsDeleted: number;
  skippedUnknownActivity: number;
}>;

export class NlpLambdaCleanupService {
  static create(options: {
    fleet: NlpLambdaFleetPort;
    logger?: Pick<Logger, "info" | "warn">;
    /** Injected so the cutoffs are testable without waiting a year. */
    now?: () => Instant;
  }): NlpLambdaCleanupService {
    return new NlpLambdaCleanupService(options.fleet, options.logger, options.now ?? nowInstant);
  }

  private constructor(
    private readonly fleet: NlpLambdaFleetPort,
    private readonly logger: Pick<Logger, "info" | "warn"> | undefined,
    private readonly now: () => Instant,
  ) {}

  async sweep(): Promise<NlpLambdaCleanupReport> {
    const at = this.now();
    const functionCutoff = at.subtract({ milliseconds: FUNCTION_IDLE_DAYS * DAY_MS });
    const logGroupCutoff = at.subtract({ milliseconds: LOG_GROUP_IDLE_DAYS * DAY_MS });
    const report = { functionsDeleted: 0, logGroupsDeleted: 0, skippedUnknownActivity: 0 };

    for (const fn of await this.fleet.listFunctions({ namePrefix: NLP_LAMBDA_NAME_PREFIX })) {
      const lastActivityAt = await this.fleet.tryReadLastActivityAt({ functionName: fn.name });
      if (!lastActivityAt) {
        report.skippedUnknownActivity++;
        this.logger?.warn(
          { functionName: fn.name },
          "no last activity for an NLP Lambda; keeping it",
        );
        continue;
      }

      if (Temporal.Instant.compare(lastActivityAt, functionCutoff) < 0) {
        await this.fleet.deleteFunction({ functionName: fn.name });
        report.functionsDeleted++;
      }

      if (Temporal.Instant.compare(lastActivityAt, logGroupCutoff) < 0) {
        await this.fleet.deleteLogGroup({ functionName: fn.name });
        report.logGroupsDeleted++;
      }
    }

    // The orphans: a log group whose function is already gone still holds the
    // customer's engine output, so it is reaped on the log cutoff rather than
    // the function one.
    for (const functionName of await this.fleet.listLogGroups({
      namePrefix: NLP_LAMBDA_NAME_PREFIX,
    })) {
      if (await this.fleet.functionExists({ functionName })) {
        continue;
      }

      const lastActivityAt = await this.fleet.tryReadLastActivityAt({ functionName });
      if (!lastActivityAt) {
        report.skippedUnknownActivity++;
        continue;
      }

      if (Temporal.Instant.compare(lastActivityAt, logGroupCutoff) < 0) {
        await this.fleet.deleteLogGroup({ functionName });
        report.logGroupsDeleted++;
      }
    }

    this.logger?.info({ ...report }, "swept the studio's quiet NLP Lambda functions");

    return report;
  }
}
