import { NoopAutomationRunawayMetrics } from "@langwatch/automation-server";
import { EmailDeliveryPort } from "@langwatch/notification-server";
import { describe, expect, it, vi } from "vitest";
import { WorkerAutomationRunawayAdapter } from "../automation-runaway.adapter";

class NoopMailer extends EmailDeliveryPort {
  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }
  send(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
}

function adapter(
  filterSuppressed: (input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>,
) {
  return WorkerAutomationRunawayAdapter.create({
    redis: null,
    directories: {
      projects: {
        getOrganizationId: vi.fn().mockResolvedValue("org-1"),
        tryGetById: vi
          .fn()
          .mockResolvedValue({ id: "project-1", name: "Project", slug: "project" }),
      },
      authorization: {
        listOrganizationBindings: vi.fn().mockResolvedValue([
          { role: "ADMIN", user: { email: "ada@example.com" } },
          { role: "ADMIN", user: { email: "grace@example.com" } },
          { role: "MEMBER", user: { email: "member@example.com" } },
        ]),
      },
    },
    suppression: { filterSuppressed },
    mailer: new NoopMailer(),
    resolveClickHouseClient: vi.fn().mockResolvedValue(null),
    metrics: NoopAutomationRunawayMetrics.create(),
    baseHost: "https://app.langwatch.test",
  });
}

describe("given the project's automation limit-email recipients", () => {
  describe("when an org admin has unsubscribed from this project's automations", () => {
    /** @scenario "An unsubscribed admin is not mailed about a limit" */
    it("is not among the recipients", async () => {
      const filterSuppressed = vi.fn().mockResolvedValue(["grace@example.com"]);
      const recipients = await adapter(filterSuppressed).notificationRecipients({
        projectId: "project-1",
        triggerId: "trigger-1",
      });

      expect(recipients).toEqual(["grace@example.com"]);
      expect(recipients).not.toContain("ada@example.com");
    });
  });

  describe("when the suppression list cannot be read", () => {
    /** @scenario "An unreadable suppression list still lets the mail out" */
    it("still notifies every org admin", async () => {
      const filterSuppressed = vi.fn().mockRejectedValue(new Error("network down"));
      const recipients = await adapter(filterSuppressed).notificationRecipients({
        projectId: "project-1",
        triggerId: "trigger-1",
      });

      expect(recipients).toEqual(["ada@example.com", "grace@example.com"]);
    });
  });
});

describe("given a trigger whose condition is a search query", () => {
  describe("when the limit email is addressed", () => {
    /** @scenario "The limit email links to a drawer that can edit the condition" */
    it("opens the automation authoring drawer on that automation", async () => {
      const url = await adapter(vi.fn()).automationUrl({
        projectId: "project-1",
        triggerId: "trigger-1",
      });

      expect(url).toBe(
        "https://app.langwatch.test/project/automations?drawer.open=automation&drawer.automationId=trigger-1",
      );
    });
  });
});

describe("given a worker holding an automation containment claim", () => {
  describe("when another worker has since retaken it", () => {
    /** @scenario "A stale claim release never frees another worker's claim" */
    it("releasing the stale claim never frees the current holder", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const worker1 = WorkerAutomationRunawayAdapter.create({
          redis: null,
          directories: {
            projects: { getOrganizationId: vi.fn(), tryGetById: vi.fn() },
            authorization: { listOrganizationBindings: vi.fn() },
          },
          suppression: { filterSuppressed: vi.fn() },
          mailer: new NoopMailer(),
          resolveClickHouseClient: vi.fn(),
          metrics: NoopAutomationRunawayMetrics.create(),
          baseHost: "https://app.langwatch.test",
        });

        const stale = await worker1.tryClaimOnce("automation-cap-mail:trigger-1:20454", 10);
        expect(stale).not.toBeNull();

        vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
        const current = await worker1.tryClaimOnce("automation-cap-mail:trigger-1:20454", 10);
        expect(current).not.toBeNull();

        await worker1.releaseClaim(stale!);

        const thirdAttempt = await worker1.tryClaimOnce("automation-cap-mail:trigger-1:20454", 10);
        expect(thirdAttempt).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
