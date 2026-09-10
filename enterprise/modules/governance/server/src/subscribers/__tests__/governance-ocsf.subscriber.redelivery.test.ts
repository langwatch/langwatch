import { describe, expect, it } from "vitest";
import {
  GovernanceOcsfEventWriter,
  type GovernanceOcsfEvent,
} from "../../app/governance.infrastructure.ts";
import { GovernanceOcsfSubscriber } from "../governance-ocsf.subscriber.ts";
import {
  governanceTraceContext,
  governanceTraceEvent,
  SilentSubscriberDiagnostics,
} from "./governance-subscriber.fixtures.ts";

class ReplacingOcsfEvents implements GovernanceOcsfEventWriter {
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
