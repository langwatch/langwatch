import type { EventingConfig } from "./config.ts";
import { consumingEventing, producerEventing } from "./eventing-role.ts";

/** A producer cannot claim the queue; a consumer also produces follow-up commands. */
export class PipelineParticipation<Mode extends "produce" | "consume" = "produce" | "consume"> {
  private constructor(readonly mode: Mode) {}

  static producer(): PipelineParticipation<"produce"> {
    return new PipelineParticipation("produce");
  }

  static consumer(): PipelineParticipation<"consume"> {
    return new PipelineParticipation("consume");
  }

  configure(defaultRetentionDays: number): EventingConfig {
    if (this.mode === "produce") {
      return producerEventing({ executionTarget: "web" });
    }
    return consumingEventing({ executionTarget: "worker", defaultRetentionDays });
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
