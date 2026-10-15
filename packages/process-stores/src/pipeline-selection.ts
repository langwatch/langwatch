import type { EventLogRetentionClassifier } from "@langwatch/eventing/server";
import { type GroupQueuePolicy, resolveGroupQueuePolicyFromEnv } from "@langwatch/group-queue";

import type { EventingConfig } from "./config.ts";
import { consumingEventing, producerEventing } from "./eventing-role.ts";

/** What the stores config states about the eventing either role runs. */
export interface PipelineSettings {
  /** The fallback retention for rows whose tenant states none, in days. */
  readonly defaultRetentionDays: number;
  /** How long the queue waits for in-flight jobs on shutdown. Absent keeps the queue's own. */
  readonly queueDrainTimeoutMs?: number | undefined;
  /** GLOBAL_QUEUE_CONCURRENCY as written; absent or invalid keeps the queue's 100. */
  readonly queueConcurrency?: string | undefined;
  /** LANGWATCH_DISPATCH_TENANT_CAP as written; absent keeps 50, "0" turns it off. */
  readonly queueTenantCap?: string | undefined;
  /** LANGWATCH_DISPATCH_GLOBAL_BUDGET as written; absent or "0" keeps the fixed cap. */
  readonly queueGlobalBudget?: string | undefined;
}

/** Only the settings the operator stated; an absent one leaves the queue's own default. */
function queuePolicyOf(settings: PipelineSettings): GroupQueuePolicy {
  const resolved = resolveGroupQueuePolicyFromEnv({
    globalConcurrency: settings.queueConcurrency,
    tenantConcurrencyCap: settings.queueTenantCap,
    globalConcurrencyBudget: settings.queueGlobalBudget,
  });
  return {
    ...(resolved.globalConcurrency === undefined
      ? {}
      : { globalConcurrency: resolved.globalConcurrency }),
    ...(resolved.tenantConcurrencyCap === undefined
      ? {}
      : { tenantConcurrencyCap: resolved.tenantConcurrencyCap }),
    ...(resolved.globalConcurrencyBudget === undefined
      ? {}
      : { globalConcurrencyBudget: resolved.globalConcurrencyBudget }),
    ...(settings.queueDrainTimeoutMs === undefined
      ? {}
      : { drainTimeoutMs: settings.queueDrainTimeoutMs }),
  };
}

/** A producer cannot claim the queue; a consumer also produces follow-up commands. */
export class PipelineParticipation<Mode extends "produce" | "consume" = "produce" | "consume"> {
  private constructor(
    readonly mode: Mode,
    private readonly classifyEventLogRetention?: EventLogRetentionClassifier,
  ) {}

  static producer(): PipelineParticipation<"produce"> {
    return new PipelineParticipation("produce");
  }

  /** Only a consumer appends, so only it classifies each event_log row for retention. */
  static consumer(
    classifyEventLogRetention?: EventLogRetentionClassifier,
  ): PipelineParticipation<"consume"> {
    return new PipelineParticipation("consume", classifyEventLogRetention);
  }

  configure(settings: PipelineSettings): EventingConfig {
    // Both roles get it, so whichever one a process runs honours the chart's drain.
    const policy = queuePolicyOf(settings);
    const queuePolicy = Object.keys(policy).length === 0 ? {} : { queuePolicy: policy };
    if (this.mode === "produce") {
      return producerEventing({ executionTarget: "web", ...queuePolicy });
    }
    return consumingEventing({
      executionTarget: "worker",
      defaultRetentionDays: settings.defaultRetentionDays,
      classifyEventLogRetention: this.classifyEventLogRetention,
      ...queuePolicy,
    });
  }
}

export class ProducerPipelines {
  produce(): PipelineParticipation<"produce"> {
    return PipelineParticipation.producer();
  }
}

export class ConsumerPipelines {
  consume(
    classifyEventLogRetention?: EventLogRetentionClassifier,
  ): PipelineParticipation<"consume"> {
    return PipelineParticipation.consumer(classifyEventLogRetention);
  }
}
