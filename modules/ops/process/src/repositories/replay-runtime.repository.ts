import type { RetentionPolicyResolver } from "@langwatch/eventing";

import type { OpsReplayRuntime } from "../app/ops.app.ts";

/**
 * Builds one replay run's engine over the stores this process holds. `create` throws when the
 * deployment cannot serve a replay; the retention the rebuilt rows carry is the caller's to pass.
 */
export abstract class ReplayRuntimeRepository {
  abstract create(input: {
    retention: RetentionPolicyResolver;
    /** Whether the queue's claimed-groups index may be trusted (ADR-092). */
    claimsIndexReady: () => Promise<boolean>;
  }): OpsReplayRuntime;
}
