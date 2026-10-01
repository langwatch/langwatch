import type { EventingConfig } from "./config.ts";
import { consumingEventing, producerEventing } from "./eventing-role.ts";

/** What the stores config states about the eventing either role runs. */
export interface PipelineSettings {
  /** The fallback retention for rows whose tenant states none, in days. */
  readonly defaultRetentionDays: number;
  /** How long the queue waits for in-flight jobs on shutdown. Absent keeps the queue's own. */
  readonly queueDrainTimeoutMs?: number | undefined;
}

/** A producer cannot claim the queue; a consumer also produces follow-up commands. */
export class PipelineParticipation<Mode extends "produce" | "consume" = "produce" | "consume"> {
  private constructor(readonly mode: Mode) {}

  static producer(): PipelineParticipation<"produce"> {
    return new PipelineParticipation("produce");
  }

  static consumer(): PipelineParticipation<"consume"> {
    return new PipelineParticipation("consume");
  }

  configure(settings: PipelineSettings): EventingConfig {
    // Both roles get it, so whichever one a process runs honours the chart's drain.
    const queuePolicy =
      settings.queueDrainTimeoutMs === undefined
        ? {}
        : { queuePolicy: { drainTimeoutMs: settings.queueDrainTimeoutMs } };
    if (this.mode === "produce") {
      return producerEventing({ executionTarget: "web", ...queuePolicy });
    }
    return consumingEventing({
      executionTarget: "worker",
      defaultRetentionDays: settings.defaultRetentionDays,
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
  consume(): PipelineParticipation<"consume"> {
    return PipelineParticipation.consumer();
  }
}
