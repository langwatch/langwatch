import type { ExecutionTarget } from "@langwatch/eventing";
import type { GroupQueuePolicy, GroupQueueStorage } from "@langwatch/group-queue";

import type { EventingConfig, EventingGroupQueueConfig } from "./config.ts";

/**
 * What either role states beyond the half of event sourcing it runs. Neither
 * names `participation`: which half a process installs follows its role, and
 * these factories name only the substrate that half needs.
 */
interface EventingRoleOptions {
  /** Which tier a command this process sends records as its origin. */
  readonly executionTarget: ExecutionTarget;
  /** Retry, lease and concurrency shape. Absent uses the queue's own. */
  readonly queuePolicy?: GroupQueuePolicy;
  /** Where an oversized payload's body is offloaded. Absent keeps it inline. */
  readonly storage?: GroupQueueStorage;
}

/**
 * A role that sends commands and drains none of them: its store refuses every
 * read by name, and the process managers its pipelines declare are registered
 * without being run, so the role that claims the queue runs them exactly once.
 */
export function producerEventing(options: EventingRoleOptions): EventingConfig {
  return {
    store: { kind: "producer-only" },
    consumersEnabled: false,
    executionTarget: options.executionTarget,
    processManagerMode: "producer-only",
    groupQueue: groupQueueConfig(options),
  };
}

/**
 * The role that claims the queue: it folds projections, runs subscribers and
 * owns the process managers, so it reads the event log rather than refusing.
 */
export function consumingEventing(
  options: EventingRoleOptions & {
    /** The fallback retention for rows whose tenant states none, in days. */
    readonly defaultRetentionDays: number;
  },
): EventingConfig {
  return {
    store: { kind: "event-log", defaultRetentionDays: options.defaultRetentionDays },
    consumersEnabled: true,
    executionTarget: options.executionTarget,
    processManagerMode: "run",
    groupQueue: groupQueueConfig(options),
  };
}

function groupQueueConfig(options: EventingRoleOptions): EventingGroupQueueConfig {
  return {
    ...(options.queuePolicy === undefined ? {} : { policy: options.queuePolicy }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
  };
}
