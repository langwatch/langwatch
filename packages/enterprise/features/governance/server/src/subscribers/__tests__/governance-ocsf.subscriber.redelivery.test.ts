import { describe, expect, it } from "vitest";
import {
  GovernanceOcsfEventPort,
  type GovernanceOcsfEvent,
} from "../../ports/governance-subscriber.port";
import { GovernanceOcsfSubscriber } from "../governance-ocsf.subscriber";
import {
  governanceTraceContext,
  governanceTraceEvent,
  SilentSubscriberDiagnostics,
} from "../../ports/__tests__/subscribers/governance-subscriber.fixtures";

class ReplacingOcsfEvents extends GovernanceOcsfEventPort {
  readonly rows = new Map<string, GovernanceOcsfEvent>();

  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    this.rows.set(`${row.tenantId}:${row.eventId}`, row);
    return Promise.resolve();
  }
}

describe("GovernanceOcsfSubscriber redelivery", () => {
  it("leaves one OCSF event when the source event is handled twice", async () => {
    const events = new ReplacingOcsfEvents();
    const subscriber = GovernanceOcsfSubscriber.create({
      events,
      diagnostics: new SilentSubscriberDiagnostics(),
    });

    await subscriber.handle(governanceTraceEvent, governanceTraceContext);
    await subscriber.handle(governanceTraceEvent, governanceTraceContext);

    expect([...events.rows.values()]).toHaveLength(1);
  });
});
