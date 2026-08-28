import type { EventSourcing } from "@langwatch/eventing";
import type { TopicService } from "@langwatch/topic-contract";
import { TopicServerInstaller } from "@langwatch/topic-server";
import type { TraceTopicAssignmentPort } from "@langwatch/trace-contract";

/** API-process producer wiring for Topic's single server installer. */
export class TopicApiFeature {
  static create(options: {
    installer: TopicServerInstaller;
    eventSourcing: EventSourcing;
    traceAssignments: TraceTopicAssignmentPort;
  }): TopicApiFeature {
    return new TopicApiFeature(options.installer, options.eventSourcing, options.traceAssignments);
  }

  private installed = false;

  private constructor(
    private readonly installer: TopicServerInstaller,
    private readonly eventSourcing: EventSourcing,
    private readonly traceAssignments: TraceTopicAssignmentPort,
  ) {}

  get service(): TopicService {
    return this.installer.service;
  }

  install(): void {
    if (this.installed) return;
    this.installer.install({
      eventSourcing: this.eventSourcing,
      traceAssignments: this.traceAssignments,
    });
    this.installed = true;
  }

  requestClustering(input: {
    projectId: string;
    occurredAt: number;
    requestedByUserId?: string;
  }): Promise<void> {
    if (!this.installed) {
      throw new Error("Topic API producer is not installed");
    }
    return this.installer.commandDispatch.requestClustering({
      tenantId: input.projectId,
      occurredAt: input.occurredAt,
      trigger: "manual",
      requestedByUserId: input.requestedByUserId,
    });
  }
}
