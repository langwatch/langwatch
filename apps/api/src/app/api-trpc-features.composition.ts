/**
 * The API process's packaged tRPC record — which this process does NOT compose. Every
 * namespace the record carried is built by a transport that still names a deleted legacy
 * builder, so the process mounts none of them and reports the absence by name.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import { ApiTrpcCollaboratorsAbsence } from "../app-trpc/app-trpc.collaborators.ts";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context.ts";

/** Writes the record's absence to the process log, with its consequence. */
export class LoggedApiTrpcFeaturesAbsence extends ApiTrpcCollaboratorsAbsence {
  static create(logger: Pick<Logger, "warn">): LoggedApiTrpcFeaturesAbsence {
    return new LoggedApiTrpcFeaturesAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(reason: "no-collaborators" | "no-database" | "unconverted-transports"): void {
    const consequence =
      reason === "no-database"
        ? "no database or no AuthZ service was composed"
        : reason === "unconverted-transports"
          ? "every namespace in the record is built by a transport that has not been converted, so none is mounted"
          : "the deployment composed no application for the record to read";
    this.logger.warn(
      { reason },
      `API process serves no packaged tRPC namespaces: ${consequence}. The agent and secret routers are unaffected.`,
    );
  }
}

/**
 * The `ctx.app` slices the record reads, each contributed by the feature that composed
 * it.
 */
export type ApiTrpcFeatureApplicationSlices = ApiTrpcFeatureApplication;
