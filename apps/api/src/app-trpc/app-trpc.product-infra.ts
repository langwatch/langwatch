/**
 * The three surfaces that answer for a project's own INFRASTRUCTURE rather
 * than for the product a member runs on it, mounted as one group.
 *
 *   storedObjects  whether one externalized blob's row and bytes are both
 *                  still there, so a renderer can tell "the file is gone" from
 *                  "that id never existed".
 *   dataRetention  how long a scope keeps what it captured, what a plan may
 *                  set it to, and how many bytes the current scope holds.
 *   monitors       the real-time evaluations running against a project's
 *                  traffic, their seven-day trend, and the copy that
 *                  replicates one into another project.
 *
 * ## Why one group rather than three entries
 *
 * They are one graph in the only sense that matters at a composition root:
 * each is answered from a store the PROCESS operates rather than from a
 * product surface — the object store's ClickHouse rows and byte backend, the
 * retention window those rows are swept on, and the evaluation runs written
 * beside them. None of the three reaches the model gateway, the NLP engine or
 * a mailer. Naming them individually on {@link AppTrpcFeaturePorts} would put
 * three entries and four type parameters on a file every other half of the
 * record also edits; naming them once here keeps the shared file's diff to one
 * import, one parameter and one spread, and keeps this group's parameters
 * where the group is.
 *
 * ## What is NOT here
 *
 * `storedObjects` takes no ports. Its one procedure reads
 * `ctx.app.storedObjectApp` and nothing else, and a surface with no port is a
 * surface a deployment cannot get wrong.
 */
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type {
  DataRetentionTrpcContext,
  DataRetentionTrpcPolicy,
} from "@langwatch/data-retention-server";
import type { MonitorTrpcContext, MonitorTrpcPorts } from "@langwatch/monitor-server";
import type { StoredObjectTrpcContext } from "@langwatch/stored-object-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

import { createDataRetentionTrpcRouter } from "../features/data-retention/data-retention-trpc.mount";
import { createMonitorTrpcRouter } from "../features/monitor/monitor-trpc.mount";
import { createStoredObjectTrpcRouter } from "../features/stored-object/stored-object-trpc.mount";

/**
 * The request context this group is resolved against: the intersection of the
 * three surfaces' own contexts.
 */
export type AppProductInfraTrpcContext = DataRetentionTrpcContext &
  MonitorTrpcContext &
  StoredObjectTrpcContext;

/**
 * The capabilities the three surfaces reach that their own feature packages do
 * not own.
 */
export interface AppProductInfraTrpcPorts<TSnapshot = unknown, TStorageUsage = unknown> {
  /**
   * The retention policy: who may write an override at a scope, which values
   * that scope's plan may persist, who may switch retention off entirely, and
   * the two RBAC-filtered reads the settings page renders.
   *
   * The transport declared these as the host's because every one of them
   * resolves organization/team/project lineage and an active plan rather than
   * retention state. The RULES are the feature's — the tiering, the floor, the
   * presets — and live in `@langwatch/data-retention-server`; what the process
   * supplies is the directory, the permission answers, the plan reading and
   * the platform-administrator allow-list they run over.
   */
  dataRetention: DataRetentionTrpcPolicy<TSnapshot, TStorageUsage>;
  /**
   * The monitor surface's four: the precondition parser its two write inputs
   * are built from, the previous window its performance trend compares to, and
   * the evaluator replication a monitor copy carries with it.
   *
   * All four are somebody else's. The precondition vocabulary is the
   * trace-filter registry's, the comparison window is Analytics', and copying
   * an evaluator — and the workflow behind it — is Evaluator's and Workflow's.
   */
  monitors: MonitorTrpcPorts;
}

/**
 * The group's ports with both parameters widened, for a host that publishes no
 * client type.
 */
export type AnyAppProductInfraTrpcPorts = AppProductInfraTrpcPorts<unknown, unknown>;

/**
 * Builds all three surfaces against one process's mount.
 *
 * Generic in the whole ports object rather than in its members: each factory
 * infers its own parameters from the slice it is handed, so the concrete
 * snapshot and usage shapes a process wired in survive into the record's
 * inferred type instead of collapsing to the widened alias above.
 */
export function createAppProductInfraTrpcFeatures<
  TContext extends AppProductInfraTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnyAppProductInfraTrpcPorts,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: TPorts;
}) {
  const { mount, ports } = options;

  return {
    dataRetention: createDataRetentionTrpcRouter({ ...mount, ports: ports.dataRetention }),
    monitors: createMonitorTrpcRouter({ ...mount, ports: ports.monitors }),
    // No ports: the probe reads `ctx.app.storedObjectApp` and nothing else.
    storedObjects: createStoredObjectTrpcRouter(mount),
  };
}
