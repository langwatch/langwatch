import type { EventSourcedQueueProcessor } from "@langwatch/eventing";
import type {
  AutomationService,
  TriggerMatchRecordedEventData,
} from "@langwatch/automation-contract";
import {
  AutomationEvaluationSubscriberService,
  AutomationEvaluationTriggerFilterService,
  AutomationTriggerMatchRecorderPort,
} from "@langwatch/automation-server";
import type { TraceService } from "@langwatch/trace-contract";

type TriggerMatchRecord = TriggerMatchRecordedEventData & {
  tenantId: string;
  occurredAt: number;
};

class AppAutomationTriggerMatchRecorderPort extends AutomationTriggerMatchRecorderPort {
  static create(
    command: EventSourcedQueueProcessor<TriggerMatchRecord>,
  ): AppAutomationTriggerMatchRecorderPort {
    return new AppAutomationTriggerMatchRecorderPort(command);
  }

  private constructor(private readonly command: EventSourcedQueueProcessor<TriggerMatchRecord>) {
    super();
  }

  send(input: TriggerMatchRecord): Promise<void> {
    return this.command.send(input);
  }
}

/** Composition root for Automation's Evaluation event-subscriber lifecycle. */
export class AppAutomationEvaluationSubscriberRuntime {
  static create(input: {
    automation: AutomationService;
    traces: TraceService;
    recordTriggerMatch: EventSourcedQueueProcessor<TriggerMatchRecord>;
  }): AutomationEvaluationSubscriberService {
    return AutomationEvaluationSubscriberService.create({
      automation: input.automation,
      traces: input.traces,
      evaluationFilters: AutomationEvaluationTriggerFilterService.create(input.traces),
      triggerMatches: AppAutomationTriggerMatchRecorderPort.create(input.recordTriggerMatch),
    });
  }
}
