import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  ObservabilityAuthzMetricsAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { Registry } from "prom-client";
import type { ApiAuthzConfig } from "../platform/config/api.config";
import type { ApiEventingInfrastructure } from "../platform/infrastructure/api-eventing.infrastructure";

/** Reports the composition decision a missing collaborator would otherwise hide. */
export abstract class ApiAuthzAbsenceReportPort {
  abstract absent(reason: "no-database" | "no-eventing"): void;
}

/** The Redis surface the permission cache's epoch counter needs, and nothing more. */
export type ApiAuthzEpochRedis = {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<unknown>;
};

export type ApiAuthzCompositionOptions = {
  database: PrismaConnection;
  eventing: ApiEventingInfrastructure;
  /** Absent disables the permission cache rather than failing a read. */
  epoch: ApiAuthzEpochRedis | null;
  config: ApiAuthzConfig;
  /** The registry this process renders, so its AuthZ samples are scrapeable. */
  registry: Registry;
};

/**
 * The API process's own AuthZ services, composed rather than received.
 *
 * Everything below the two contract services is the feature package's:
 * `PostgresAuthzAdapter` builds the read repositories, the ledger writer, the
 * epoch cache, the cutover gate and the grants pipeline definition from ONE
 * guarded Prisma client. What kept this process from calling it was never the
 * database — it was the command dispatcher, which needs an Eventing
 * registration and which no package implemented.
 *
 * What this process supplies:
 *
 *  - The dispatcher binds to a PRODUCER-only registration of the SAME packaged
 *    pipeline definition the worker installs. Nothing here forks it — a forked
 *    definition is two descriptions of one persisted event stream, and the
 *    routing metadata a command carries is stamped from the pipeline and
 *    command names at send time, so a command produced here is routed by the
 *    consumer's registry exactly as one produced there is.
 *  - The counters, handed in as an `AuthzMetricsPort` over this process's own
 *    registry, so both tiers write one series described one way. It is the
 *    PORT rather than the registry that crosses now: the feature builds the
 *    cutover reporter and the revocation telemetry over whatever it is given,
 *    and a tier that renders no scrape endpoint composes the same AuthZ graph
 *    and counts nothing.
 *
 * Registration is passive on purpose. This process starts no consumer loop and
 * owns no event log: it enqueues commands and the worker appends their events
 * and folds their projections, which is what makes the split location
 * independent rather than a second writer racing the first.
 */
export class ApiAuthzComposition {
  /**
   * Composes AuthZ only when this process has both halves of the write path.
   *
   * A database with no queue is not a smaller AuthZ service, it is one whose
   * every grant change would block for the ledger wait and then refuse. Saying
   * so at boot is the difference between a deployment that reads "no AuthZ" in
   * its logs and one that discovers it on the first membership change.
   */
  static tryCompose(
    options: Omit<ApiAuthzCompositionOptions, "database" | "eventing"> & {
      database: PrismaConnection | undefined;
      eventing: ApiEventingInfrastructure | undefined;
      report?: ApiAuthzAbsenceReportPort;
    },
  ): ApiAuthzComposition | undefined {
    if (!options.database) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!options.eventing) {
      options.report?.absent("no-eventing");
      return undefined;
    }
    return ApiAuthzComposition.compose({
      ...options,
      database: options.database,
      eventing: options.eventing,
    });
  }

  static compose(options: ApiAuthzCompositionOptions): ApiAuthzComposition {
    const dispatcher = EventingAuthzCommandDispatcherAdapter.create();
    const bindingIds = KsuidAuthzBindingIdAdapter.create();

    const built = PostgresAuthzAdapter.create({
      // The typed client satisfies the feature's structural database port on
      // its own terms: `PostgresAuthzDatabase` describes eighteen delegates in
      // `unknown` arguments so no generated type crosses into the package, and
      // a guarded `PrismaClient` is assignable to every one of them. No
      // assertion sits at this seam, and none should — an assertion here would
      // be the composition root promising a shape it had not checked.
      database: options.database.client,
      redis: options.epoch,
      dispatcher,
      // This process renders a scrape endpoint, so AuthZ's two counters go
      // through its own registry. The feature builds the cutover reporter and
      // the revocation telemetry over them.
      metrics: ObservabilityAuthzMetricsAdapter.create({ registry: options.registry }),
      newBindingId: () => bindingIds.newBindingId(),
      cacheEnabled: () => options.config.epochCacheEnabled,
      demoProjectId: () => options.config.demoProjectId,
    }).build();

    // The ledger's write path opens here and nowhere else: until `connect`
    // runs, a grant change waits for the senders and then refuses with a
    // ledger-unavailable error rather than silently taking the imperative
    // Prisma path.
    const registered = options.eventing.eventSourcing.register(built.pipeline);
    dispatcher.connect(EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands));

    return new ApiAuthzComposition(built.authz, built.grants);
  }

  private constructor(
    readonly permissions: AuthzService,
    readonly grants: AuthzGrantsService,
  ) {}
}
