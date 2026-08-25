import { describe, expect, it } from "vitest";
import {
  GovernanceKpiContributionPort,
  type GovernanceKpiContribution,
} from "../../src/ports/governance-subscriber.port";
import { GovernanceKpisSubscriber } from "../../src/subscribers/governance-kpis.subscriber";
import {
  governanceTraceContext,
  governanceTraceEvent,
  SilentSubscriberDiagnostics,
} from "./governance-subscriber.fixtures";

class ReplacingKpiContributions extends GovernanceKpiContributionPort {
  readonly rows = new Map<string, GovernanceKpiContribution>();

  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    const key = [row.tenantId, row.sourceId, row.hourBucket.getTime(), row.traceId].join(
      ":",
    );
    this.rows.set(key, row);
    return Promise.resolve();
  }
}

describe("GovernanceKpisSubscriber redelivery", () => {
  it("leaves one replacement row when the source event is handled twice", async () => {
    const contributions = new ReplacingKpiContributions();
    const subscriber = GovernanceKpisSubscriber.create({
      contributions,
      diagnostics: new SilentSubscriberDiagnostics(),
    });

    await subscriber.handle(governanceTraceEvent, governanceTraceContext);
    await subscriber.handle(governanceTraceEvent, governanceTraceContext);

    expect([...contributions.rows.values()]).toHaveLength(1);
  });
});
