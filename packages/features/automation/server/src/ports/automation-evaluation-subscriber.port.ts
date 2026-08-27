import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";

export abstract class AutomationEvaluationTriggerFilterPort {
  abstract readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean;
}

export abstract class AutomationTriggerMatchRecorderPort {
  abstract send(
    input: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}
