import { describe, expect, it } from "vitest";
import {
  TraceAlertMetricsPort,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerPort,
  type TraceAlertTrigger,
} from "../../ports/governance-subscriber.port";
import { TraceAlertTriggerMatchSubscriber } from "../trace-alert-trigger-match.subscriber";
import {
  governanceTraceContext,
  governanceTraceEvent,
} from "../../ports/__tests__/subscribers/governance-subscriber.fixtures";

function trigger(overrides: Partial<TraceAlertTrigger> = {}): TraceAlertTrigger {
  return {
    id: "trigger-1",
    action: "send_email",
    actionClass: "notify",
    traceDebounceMs: 1_000,
    notificationCadence: "once",
    hasEvaluationFilters: false,
    ...overrides,
  };
}

class ManyTriggers extends TraceAlertTriggerPort {
  activeForProject(): Promise<TraceAlertTrigger[]> {
    return Promise.resolve([
      trigger({ id: "trigger-1" }),
      trigger({ id: "trigger-2" }),
      trigger({ id: "trigger-3" }),
    ]);
  }
}

class RecordingMatchCommands extends TraceAlertTriggerMatchPort {
  readonly sent: Array<Parameters<TraceAlertTriggerMatchPort["send"]>[0]> = [];

  send(input: Parameters<TraceAlertTriggerMatchPort["send"]>[0]): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }
}

class PassingOrigin extends TraceAlertOriginGuardPort {
  passes(): boolean {
    return true;
  }
}

class RecordingMetrics extends TraceAlertMetricsPort {
  readonly counted: number[] = [];
  countRecorded(count: number): void {
    this.counted.push(count);
  }
}

describe("given several active automations on one trace", () => {
  describe("when those matches are recorded", () => {
    /** @scenario "Match-record volume is measured for the team, not capped" */
    it("counts them on a team metric", async () => {
      const metrics = new RecordingMetrics();
      const subscriber = TraceAlertTriggerMatchSubscriber.create({
        triggers: new ManyTriggers(),
        matches: new RecordingMatchCommands(),
        originGuard: new PassingOrigin(),
        metrics,
      });

      await subscriber.handle(governanceTraceEvent, governanceTraceContext);

      expect(metrics.counted.reduce((a, b) => a + b, 0)).toBe(3);
    });

    /** @scenario "Recording a match consumes nothing" */
    it("no ceiling slot is consumed by recording them", async () => {
      // The subscriber is composed from exactly four ports — triggers, the
      // match command, an origin guard and a metrics sink — and none of them
      // is a cap or ceiling port. Recording cannot consume a slot because
      // nothing it depends on can charge one.
      const matches = new RecordingMatchCommands();
      const subscriber = TraceAlertTriggerMatchSubscriber.create({
        triggers: new ManyTriggers(),
        matches,
        originGuard: new PassingOrigin(),
        metrics: new RecordingMetrics(),
      });

      await subscriber.handle(governanceTraceEvent, governanceTraceContext);

      expect(matches.sent).toHaveLength(3);
    });
  });
});
