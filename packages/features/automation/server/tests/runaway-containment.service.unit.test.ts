import { describe, expect, it, vi } from "vitest";
import type {
  AutomationPersistCapBreach,
  AutomationRunawayTrigger,
} from "@langwatch/automation-contract";
import { AutomationRunawayPort } from "../src/ports/automation-runaway.port";
import {
  RunawayContainmentService,
  RUNAWAY_PAUSE_REASON,
} from "../src/services/runaway-containment.service";

class TestRunawayPort extends AutomationRunawayPort {
  readonly paused = vi.fn();
  readonly emailed = vi.fn<
    (input: { kind: "ceiling_reached" | "paused" }) => Promise<void>
  >(async () => undefined);
  private readonly claimed = new Set<string>();
  count = 1_000;
  failEmail = false;
  async countProjectTraces24h(): Promise<number> {
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

const trigger = (
  overrides: Partial<AutomationRunawayTrigger> = {},
): AutomationRunawayTrigger => ({
  id: "trigger-1",
  name: "Every trace",
  triggerKind: "AUTOMATION",
  customGraphId: null,
  filterQuery: null,
  filters: {},
  ...overrides,
});

function breach(
  overrides: Partial<AutomationPersistCapBreach> = {},
): AutomationPersistCapBreach {
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

  it("leaves a filtered automation active below the traffic-share threshold", async () => {
    const { port, service } = runtime();
    await service.handle(
      breach({
        trigger: trigger({ filters: { status: ["error"] } }),
        count: 899,
        skipped: 799,
      }),
    );
    expect(port.paused).not.toHaveBeenCalled();
    expect(port.emailed).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ceiling_reached" }),
    );
  });

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
});
