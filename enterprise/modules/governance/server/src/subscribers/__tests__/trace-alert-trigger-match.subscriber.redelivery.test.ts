import { describe, expect, it } from "vitest";
import {
  TraceAlertMetricsSink,
  TraceAlertOriginGuard,
  TraceAlertTriggerMatchChannel,
  TraceAlertTriggerReader,
  type TraceAlertTrigger,
} from "../../app/governance.members.ts";
import { TraceAlertTriggerMatchSubscriber } from "../trace-alert-trigger-match.subscriber.ts";
import {
  governanceTraceContext,
  governanceTraceEvent,
} from "./governance-subscriber.fixtures.ts";

class FixedTriggers implements TraceAlertTriggerReader {
  activeForProject(): Promise<TraceAlertTrigger[]> {
    return Promise.resolve([
      {
        id: "trigger-1",
        action: "send_email",
        actionClass: "notify",
        traceDebounceMs: 1_000,
        notificationCadence: "once",
        hasEvaluationFilters: false,
      },
    ]);
  }
}

class DeduplicatingMatchCommands implements TraceAlertTriggerMatchChannel {
  readonly commands = new Map<string, Parameters<TraceAlertTriggerMatchChannel["send"]>[0]>();

  send(input: Parameters<TraceAlertTriggerMatchChannel["send"]>[0]): Promise<void> {
    const key = `${input.triggerId}:${input.traceId}:${input.occurredAt}`;
    this.commands.set(key, input);
    return Promise.resolve();
  }
}

class PassingOrigin implements TraceAlertOriginGuard {
  passes(): boolean {
    return true;
  }
}

class NullMetrics implements TraceAlertMetricsSink {
  countRecorded(): void {}
}

describe("TraceAlertTriggerMatchSubscriber redelivery", () => {
  it("leaves one durable command when the source event is handled twice", async () => {
    const matches = new DeduplicatingMatchCommands();
    const subscriber = TraceAlertTriggerMatchSubscriber.create({
      triggers: new FixedTriggers(),
      matches,
      originGuard: new PassingOrigin(),
      metrics: new NullMetrics(),
    });

    await subscriber.handle(governanceTraceEvent, governanceTraceContext);
    await subscriber.handle(governanceTraceEvent, governanceTraceContext);

    expect([...matches.commands.values()]).toHaveLength(1);
  });
});
