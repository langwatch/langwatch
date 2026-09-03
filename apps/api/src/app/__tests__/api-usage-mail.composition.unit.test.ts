import type { PlanProvider } from "@langwatch/entitlement-contract";
import { EmailDeliveryPort, type EmailContent } from "@langwatch/notification-server";
import { describe, expect, it } from "vitest";
import {
  ApiEntitlementAbsenceReport,
  composeApiPlanProvider,
  composeApiUsageStats,
} from "../api-usage.composition";
import type { ApiMailComposition } from "../api-mail.composition";

/**
 * The approaching-limit mail, driven through the REAL warning service.
 *
 * `composeApiUsageStats` builds `UsageWarningService` over the packaged
 * notification store, the administrators this process reads out of Postgres,
 * the per-project breakdown it reads out of ClickHouse and the mail gateway it
 * composed; nothing between the tRPC port and the gateway is a stub. That is
 * what makes these assertions worth anything: the absence they replace claimed
 * "the only `UsageLimitEmailAdapter` in the tree sends nothing", and a test
 * that only checked `sent: true` would have passed against the null adapter.
 */
class RecordingGateway extends EmailDeliveryPort {
  readonly sent: EmailContent[] = [];

  override defaultFrom(): string {
    return "LangWatch <no-reply@example.test>";
  }

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

class RecordingEntitlementAbsence extends ApiEntitlementAbsenceReport {
  readonly sources: string[] = [];

  absent(source: "licence" | "subscription" | "usage-mail"): void {
    this.sources.push(source);
  }
}

function composedMail(gateway: EmailDeliveryPort): ApiMailComposition {
  return { delivery: gateway, baseHost: "https://app.example.test" };
}

/** One `total` or `projectId`/`total` answer, whichever the query asked for. */
function clickHouse(rows: unknown[]) {
  return {
    resolveClient: async () => ({ query: async () => ({ json: async () => rows }) }) as never,
    resolveOrganizationClient: async () =>
      ({ query: async () => ({ json: async () => rows }) }) as never,
  };
}

type NotificationRow = { organizationId: string; metadata: unknown; sentAt: Date };

/**
 * The rows the composed graph actually reads and writes.
 *
 * `organization.findUnique` answers one row carrying every field either reader
 * selects — the counter takes `pricingModel`, the directory takes the name and
 * the administrators — because a Prisma double cannot honour two `select`s and
 * splitting it would hide that both reads land on the same row.
 */
function usagePrisma(options: {
  written: NotificationRow[];
  alreadySent?: Array<{ metadata: unknown }>;
  adminEmails?: Array<string | null>;
}) {
  const emails = options.adminEmails ?? ["admin@acme.test"];
  return {
    organization: {
      findUnique: async () => ({
        id: "org-1",
        name: "Acme",
        pricingModel: null,
        sentPlanLimitAlert: null,
        members: emails.map((email, index) => ({
          user: { id: `user-${index + 1}`, name: "Ada", email },
        })),
      }),
      update: async () => ({}),
    },
    project: {
      findMany: async () => [
        { id: "project-1", name: "Checkout" },
        { id: "project-2", name: "Search" },
      ],
    },
    notification: {
      findMany: async () =>
        (options.alreadySent ?? []).map((row, index) => ({
          id: `notification-${index + 1}`,
          organizationId: "org-1",
          projectId: null,
          metadata: row.metadata,
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
          sentAt: new Date("2026-09-01T00:00:00.000Z"),
        })),
      create: async ({ data }: { data: NotificationRow }) => {
        options.written.push(data);
        return {
          id: "notification-written",
          organizationId: data.organizationId,
          projectId: null,
          metadata: data.metadata,
          createdAt: new Date("2026-09-02T00:00:00.000Z"),
          updatedAt: new Date("2026-09-02T00:00:00.000Z"),
          sentAt: data.sentAt,
        };
      },
    },
    organizationUser: { findMany: async () => [] },
    organizationInvite: { findMany: async () => [] },
    customRole: { findMany: async () => [] },
    team: { findMany: async () => [] },
    roleBinding: { findMany: async () => [] },
    cost: { aggregate: async () => ({ _sum: { amount: 0 } }) },
  } as unknown as Parameters<typeof composeApiUsageStats>[0]["prisma"];
}

/** A plan that is not free, which is the branch metered in TRACES. */
const paidPlan = {
  getActivePlan: async () => ({ free: false, planSource: "baseline", name: "Launch" }),
} as unknown as PlanProvider;

const CROSSED_95_PERCENT = { currentMonthMessagesCount: 9_500, maxMonthlyUsageLimit: 10_000 };

describe("composeApiUsageStats, the approaching-limit mail", () => {
  describe("given a deployment holding a mail gateway", () => {
    it("renders the warning and delivers it to the organization's administrators", async () => {
      const gateway = new RecordingGateway();
      const written: NotificationRow[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written }),
        // Free tier, which is the branch metered in EVENTS: one
        // organization-keyed read answers the whole breakdown.
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: clickHouse([
          { projectId: "project-1", total: "6000" },
          { projectId: "project-2", total: "3500" },
        ]),
        mail: composedMail(gateway),
        processName: "langwatch-api-test",
      });

      const notification = await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      expect(gateway.sent).toHaveLength(1);
      expect(gateway.sent[0]?.to).toBe("admin@acme.test");
      expect(gateway.sent[0]?.subject).toBe("Usage Limit Critical - 95% of limit reached");
      expect(notification).toMatchObject({ id: "notification-written" });
    });

    it("renders the organization, the projects and the counts a person reads", async () => {
      const gateway = new RecordingGateway();

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written: [] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: clickHouse([
          { projectId: "project-1", total: "6000" },
          { projectId: "project-2", total: "3500" },
        ]),
        mail: composedMail(gateway),
        processName: "langwatch-api-test",
      });

      await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      const html = gateway.sent[0]?.html ?? "";
      // The message is react-email rendered in this process. Its substance is
      // the per-project table, which is the half a null adapter never had.
      expect(html).toContain("Acme");
      expect(html).toContain("Checkout");
      expect(html).toContain("Search");
      expect(html).toContain("6,000");
      expect(html).toContain("3,500");
      // The button, on this deployment's own host rather than app.langwatch.ai.
      expect(html).toContain("https://app.example.test/settings/usage");
    });

    it("records that it went, so the same threshold is not warned about twice this month", async () => {
      const written: NotificationRow[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: clickHouse([{ projectId: "project-1", total: "9500" }]),
        mail: composedMail(new RecordingGateway()),
        processName: "langwatch-api-test",
      });

      await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      expect(written).toHaveLength(1);
      expect(written[0]?.metadata).toMatchObject({
        type: "USAGE_LIMIT_WARNING",
        threshold: 95,
        recipientsSuccessCount: 1,
      });
    });

    it("sends nothing when this month's warning for the threshold already went", async () => {
      const gateway = new RecordingGateway();

      const usage = composeApiUsageStats({
        prisma: usagePrisma({
          written: [],
          alreadySent: [{ metadata: { type: "USAGE_LIMIT_WARNING", threshold: 95 } }],
        }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: clickHouse([{ projectId: "project-1", total: "9500" }]),
        mail: composedMail(gateway),
        processName: "langwatch-api-test",
      });

      const notification = await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      expect(notification).toBeNull();
      expect(gateway.sent).toEqual([]);
    });

    it("names no absent mail, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiUsageStats({
        prisma: usagePrisma({ written: [] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: null,
        mail: composedMail(new RecordingGateway()),
        processName: "langwatch-api-test",
        report,
      });

      expect(report.sources).toEqual([]);
    });
  });

  describe("given an organization metered in traces", () => {
    it("asks each project's own endpoint and renders the breakdown it got back", async () => {
      const gateway = new RecordingGateway();
      const tenantsAsked: string[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written: [] }),
        plans: paidPlan,
        clickhouse: {
          resolveClient: async (tenantId: string) => {
            tenantsAsked.push(tenantId);
            return {
              query: async () => ({
                json: async () => [{ total: tenantId === "project-1" ? "6000" : "3500" }],
              }),
            } as never;
          },
          resolveOrganizationClient: async () => {
            throw new Error("an organization id must never reach the tenant-keyed rollup here");
          },
        },
        mail: composedMail(gateway),
        processName: "langwatch-api-test",
      });

      await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      // The trace rollup answers a total over a set of tenant ids and has no
      // per-project shape, so the breakdown costs one routed read per project.
      expect(tenantsAsked).toEqual(["project-1", "project-2"]);
      expect(gateway.sent[0]?.html).toContain("6,000");
      expect(gateway.sent[0]?.html).toContain("3,500");
    });
  });

  describe("given a process that opened no ClickHouse", () => {
    /** @scenario The usage-limit email is skipped rather than sent with zeros */
    it("sends nothing, rather than a breakdown reading zero for every project", async () => {
      const gateway = new RecordingGateway();
      const written: NotificationRow[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written }),
        plans: composeApiPlanProvider({ isSaas: true }),
        // An unread rollup and a quiet month are different facts, and the
        // events rollup is a GROUP BY: both come back empty. Composing over no
        // ClickHouse is the one place that difference is still known.
        clickhouse: null,
        mail: composedMail(gateway),
        processName: "langwatch-api-test",
      });

      const notification = await usage.ports().checkAndSendWarning(undefined as never, {
        organizationId: "org-1",
        ...CROSSED_95_PERCENT,
      });

      expect(gateway.sent).toEqual([]);
      expect(notification).toBeNull();
      // Nothing recorded either: a row written after nothing was delivered
      // would suppress the retry that could still reach somebody.
      expect(written).toEqual([]);
    });
  });

  describe("given a deployment that named no BASE_HOST", () => {
    it("refuses the warning by name rather than reporting a message it never sent", async () => {
      const report = new RecordingEntitlementAbsence();

      const usage = composeApiUsageStats({
        prisma: usagePrisma({ written: [] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: null,
        processName: "langwatch-api-test",
        report,
      });

      await expect(
        usage.ports().checkAndSendWarning(undefined as never, {
          organizationId: "org-1",
          ...CROSSED_95_PERCENT,
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(report.sources).toEqual(["usage-mail"]);
    });
  });
});
