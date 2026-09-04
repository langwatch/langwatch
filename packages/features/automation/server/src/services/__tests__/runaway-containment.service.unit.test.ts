import { describe, expect, it, vi } from "vitest";
import type {
  AutomationPersistCapBreach,
  AutomationRunawayTrigger,
} from "@langwatch/automation-contract";
import { AutomationRunawayPort } from "../../ports/automation-runaway.port";
import { RunawayContainmentService, RUNAWAY_PAUSE_REASON } from "../runaway-containment.service";

class TestRunawayPort extends AutomationRunawayPort {
  readonly paused = vi.fn();
  readonly emailed = vi.fn<(input: { kind: "ceiling_reached" | "paused" }) => Promise<void>>(
    async () => undefined,
  );
  private readonly claimed = new Set<string>();
  /** Every port call in the order the policy made it. */
  readonly calls: string[] = [];
  count = 1_000;
  failEmail = false;
  async countProjectTraces24h(): Promise<number> {
    this.calls.push("count-project-traces");
    return this.count;
  }
  async notificationRecipients(): Promise<string[]> {
    return ["admin@example.com"];
  }
  async sendLimitEmail(input: {
    to: string[];
    kind: "ceiling_reached" | "paused";
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
  }): Promise<void> {
    if (this.failEmail) throw new Error("mailer down");
    await this.emailed(input);
  }
  async tryClaimOnce(key: string): Promise<{ key: string; token: string } | null> {
    this.calls.push(`claim:${key}`);
    if (this.claimed.has(key)) return null;
    this.claimed.add(key);
    return { key, token: key };
  }
  async releaseClaim(lease: { key: string; token: string }): Promise<void> {
    this.claimed.delete(lease.key);
  }
  async projectName(): Promise<string> {
    return "Project";
  }
  async automationUrl(): Promise<string> {
    return "https://app/project/automations";
  }
  onCeilingBreach(): void {}
  onAutoPaused(): void {}
  onContainmentFailed(): void {}
  error(): void {}
  info(): void {}
}

const trigger = (overrides: Partial<AutomationRunawayTrigger> = {}): AutomationRunawayTrigger => ({
  id: "trigger-1",
  name: "Every trace",
  triggerKind: "AUTOMATION",
  customGraphId: null,
  filterQuery: null,
  filters: {},
  ...overrides,
});

function breach(overrides: Partial<AutomationPersistCapBreach> = {}): AutomationPersistCapBreach {
  return {
    trigger: trigger(),
    projectId: "project-1",
    count: 1_000,
    cap: 100,
    skipped: 900,
    ...overrides,
  };
}

function runtime(port = new TestRunawayPort()): {
  port: TestRunawayPort;
  service: RunawayContainmentService;
} {
  const service = RunawayContainmentService.create({
    runaway: port,
    triggers: { update: port.paused } as never,
    clock: { now: () => new Date("2026-01-01T00:00:00Z") } as never,
  });
  return { port, service };
}

describe("runaway containment policy", () => {
  /** @scenario "A grandfathered match-everything automation is paused on breach" */
  it("pauses a condition-less automation and sends a paused notification", async () => {
    const { port, service } = runtime();
    await service.handle(breach());
    expect(port.paused).toHaveBeenCalledWith({
      id: "trigger-1",
      projectId: "project-1",
      active: false,
      pausedReason: RUNAWAY_PAUSE_REASON,
      pausedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(port.emailed).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "paused", dailyCeiling: 100 }),
    );
  });

  /** @scenario "The customer is emailed once on the first day a trigger breaches" */
  it("claims the containment check first and mails once for the UTC day", async () => {
    const { port, service } = runtime();
    const check = {
      key: "automation-containment-check:trigger-1",
      token: "automation-containment-check:trigger-1",
    };
    const pause = { key: "automation-pause:trigger-1", token: "automation-pause:trigger-1" };

    await service.handle(breach());
    await port.releaseClaim(check);
    await port.releaseClaim(pause);
    await service.handle(breach());

    // The check is claimed before anything else, and a condition-less trigger
    // is contained without reading the project's traffic at all.
    expect(port.calls[0]).toBe(`claim:${check.key}`);
    expect(port.calls).not.toContain("count-project-traces");
    expect(port.paused).toHaveBeenCalledTimes(2);
    expect(port.emailed).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A busy but selective automation is never paused" */
  /** @scenario "A throttled automation stays active" */
  it("leaves a filtered automation active below the traffic-share threshold", async () => {
    const { port, service } = runtime();
    const filtered = () =>
      breach({
        trigger: trigger({ filters: { status: ["error"] } }),
        count: 899,
        skipped: 799,
      });
    const check = {
      key: "automation-containment-check:trigger-1",
      token: "automation-containment-check:trigger-1",
    };

    await service.handle(filtered());
    await port.releaseClaim(check);
    await service.handle(filtered());

    expect(port.paused).not.toHaveBeenCalled();
    expect(port.emailed).toHaveBeenCalledWith(expect.objectContaining({ kind: "ceiling_reached" }));
    expect(port.emailed).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A limit email that could not be sent is tried again" */
  it("contains notifier failures and releases the day claim for retry", async () => {
    const port = new TestRunawayPort();
    port.failEmail = true;
    const releaseClaim = vi.spyOn(port, "releaseClaim");
    const { service } = runtime(port);
    await expect(
      service.handle(
        breach({
          trigger: trigger({ filters: { status: ["error"] } }),
          count: 100,
          cap: 10,
          skipped: 90,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ key: "automation-cap-mail:trigger-1:20454" }),
    );
  });

  /** @scenario "An automation matching nearly all traffic is paused" */
  it("pauses a filtered trigger whose confirmed matches cover almost all project traffic", async () => {
    const port = new TestRunawayPort();
    port.count = 1_000;
    const { service } = runtime(port);
    await service.handle(
      breach({
        trigger: trigger({ filters: { status: ["error"] } }),
        count: 950,
        cap: 100,
        skipped: 850,
      }),
    );

    expect(port.paused).toHaveBeenCalledWith(
      expect.objectContaining({ pausedReason: RUNAWAY_PAUSE_REASON }),
    );
    expect(port.emailed).toHaveBeenCalledWith(expect.objectContaining({ kind: "paused" }));
  });

  /** @scenario "A breach storm measures the project's traffic once per window" */
  it("measures the project's traffic once per containment-check window", async () => {
    const port = new TestRunawayPort();
    const { service } = runtime(port);
    const filtered = () =>
      breach({ trigger: trigger({ filters: { status: ["error"] } }), count: 899, skipped: 799 });

    await service.handle(filtered());
    await service.handle(filtered());
    await service.handle(filtered());

    expect(port.calls.filter((call) => call === "count-project-traces")).toHaveLength(1);
  });

  /** @scenario "A breach raises a team metric rather than only a customer email" */
  it("counts the breach on a team metric even though the trigger has no condition", async () => {
    const port = new TestRunawayPort();
    const onCeilingBreach = vi.spyOn(port, "onCeilingBreach");
    const { service } = runtime(port);

    await service.handle(breach());

    expect(onCeilingBreach).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A failed pause is retried rather than claimed away" */
  it("retries a pause that failed to write rather than claiming it away for good", async () => {
    const port = new TestRunawayPort();
    let writes = 0;
    const failThenSucceed = vi.fn(async () => {
      writes += 1;
      if (writes === 1) throw new Error("db write failed");
    });
    const service = RunawayContainmentService.create({
      runaway: port,
      triggers: { update: failThenSucceed } as never,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") } as never,
    });

    await service.handle(breach());
    // The attempt gate (60s) has expired, so a later breach retries the pause
    // rather than finding it permanently claimed away.
    await port.releaseClaim({
      key: "automation-containment-check:trigger-1",
      token: "automation-containment-check:trigger-1",
    });
    await port.releaseClaim({
      key: "automation-pause:trigger-1",
      token: "automation-pause:trigger-1",
    });
    await service.handle(breach());

    expect(failThenSucceed).toHaveBeenCalledTimes(2);
    // No pause email was sent for the attempt that never landed: the pause
    // claim was retaken by the retry, not double-notified.
    expect(port.emailed).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A paused automation stops recording matches" */
  it("drops the trigger from the active set the same write that pauses it", async () => {
    const port = new TestRunawayPort();
    // A minimal repository standing in for the real one: no TTL cache layer
    // exists any more, so the active set this reads IS the write below —
    // there is nothing left to invalidate.
    const active = new Set(["trigger-1"]);
    const service = RunawayContainmentService.create({
      runaway: port,
      triggers: {
        update: async (input: { id: string; active: boolean }) => {
          if (!input.active) active.delete(input.id);
        },
      } as never,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") } as never,
    });

    expect(active).toContain("trigger-1");
    await service.handle(breach());
    expect(active).not.toContain("trigger-1");
  });
});
