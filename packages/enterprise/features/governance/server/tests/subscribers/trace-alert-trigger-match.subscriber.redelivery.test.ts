import { describe, expect, it } from "vitest";
import {
  TraceAlertMetricsPort,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerPort,
  type TraceAlertTrigger,
} from "../../src/ports/governance-subscriber.port";
import { TraceAlertTriggerMatchSubscriber } from "../../src/subscribers/trace-alert-trigger-match.subscriber";
import {
  governanceTraceContext,
  governanceTraceEvent,
} from "./governance-subscriber.fixtures";

class FixedTriggers extends TraceAlertTriggerPort {
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

class DeduplicatingMatchCommands extends TraceAlertTriggerMatchPort {
  readonly commands = new Map<
    string,
    Parameters<TraceAlertTriggerMatchPort["send"]>[0]
  >();

  send(input: Parameters<TraceAlertTriggerMatchPort["send"]>[0]): Promise<void> {
    const key = `${input.triggerId}:${input.traceId}:${input.occurredAt}`;
    this.commands.set(key, input);
    return Promise.resolve();
  }
}

class PassingOrigin extends TraceAlertOriginGuardPort {
  passes(): boolean {
    return true;
  }
}

class NullMetrics extends TraceAlertMetricsPort {
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
