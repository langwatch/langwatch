/**
 * The wiring half of containment: the deep link the limit email hands the
 * customer, and who that email is allowed to reach. Both are claims about the
 * strings and lists the dependency factory produces, so they are exercised
 * against stub collaborators rather than a database.
 */
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { ProjectService } from "../../projects/project.service";
import type { EmailSuppressionService } from "../emailSuppression.service";
import { defaultRunawayContainmentDeps } from "../runaway-containment.deps";
import type { TriggerService } from "../trigger.service";

const resolveOrganizationId = vi.fn<(projectId: string) => Promise<string>>();

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: (projectId: string) =>
    resolveOrganizationId(projectId),
}));

const findMany = vi.fn();
const filterSuppressed = vi.fn();

function makeDeps() {
  return defaultRunawayContainmentDeps({
    prisma: {
      organizationUser: { findMany },
    } as unknown as PrismaClient,
    triggers: {} as TriggerService,
    projects: {
      getById: async () => ({ slug: "acme-proj" }),
    } as unknown as ProjectService,
    emailSuppressions: {
      filterSuppressed,
    } as unknown as EmailSuppressionService,
    baseHost: "https://app.langwatch.ai",
    // Only the trace count reaches ClickHouse, and nothing here counts traces.
    resolveClickHouseClient: (async () => {
      throw new Error("not used");
    }) as unknown as ClickHouseClientResolver,
  });
}

describe("defaultRunawayContainmentDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrganizationId.mockResolvedValue("org_1");
    findMany.mockResolvedValue([
      { user: { email: "admin@example.com" } },
      { user: { email: "second@example.com" } },
    ]);
    filterSuppressed.mockImplementation(
      async ({ emails }: { emails: string[] }) => emails,
    );
  });

  describe("given a limit email is being addressed", () => {
    describe("when the deep link is built", () => {
      /** @scenario "The limit email links to a drawer that can edit the condition" */
      it("opens the authoring drawer on the automation", async () => {
        const url = await makeDeps().automationUrl({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(url).toBe(
          "https://app.langwatch.ai/acme-proj/automations?drawer.open=automation&drawer.automationId=trigger-1",
        );
      });

      /** @scenario "The limit email links to a drawer that can edit the condition" */
      it("does not open the legacy structured-filter drawer", async () => {
        const url = await makeDeps().automationUrl({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(url).not.toContain("editAutomationFilter");
      });
    });

    describe("when an admin unsubscribed from this project's automations", () => {
      /** @scenario "An unsubscribed admin is not mailed about a limit" */
      it("drops that admin from the recipients", async () => {
        filterSuppressed.mockResolvedValue(["second@example.com"]);

        const to = await makeDeps().notificationRecipients({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(to).toEqual(["second@example.com"]);
        expect(filterSuppressed).toHaveBeenCalledWith({
          projectId: "project-1",
          triggerId: "trigger-1",
          emails: ["admin@example.com", "second@example.com"],
        });
      });
    });

    describe("when the suppression list cannot be read", () => {
      /** @scenario "An unreadable suppression list still lets the mail out" */
      it("notifies every admin rather than nobody", async () => {
        filterSuppressed.mockRejectedValue(new Error("connection terminated"));

        const to = await makeDeps().notificationRecipients({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(to).toEqual(["admin@example.com", "second@example.com"]);
      });
    });

    describe("when the project has no organization", () => {
      it("addresses nobody and never reads the suppression list", async () => {
        resolveOrganizationId.mockResolvedValue(undefined as unknown as string);

        const to = await makeDeps().notificationRecipients({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(to).toEqual([]);
        expect(filterSuppressed).not.toHaveBeenCalled();
      });
    });

    describe("when no admin has an email address", () => {
      it("skips the suppression read", async () => {
        findMany.mockResolvedValue([{ user: { email: null } }]);

        const to = await makeDeps().notificationRecipients({
          projectId: "project-1",
          triggerId: "trigger-1",
        });

        expect(to).toEqual([]);
        expect(filterSuppressed).not.toHaveBeenCalled();
      });
    });
  });
});
