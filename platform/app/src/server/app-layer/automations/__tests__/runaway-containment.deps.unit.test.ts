/**
 * The wiring half of containment: the deep link the limit email hands the
 * customer, and who that email is allowed to reach. Both are claims about the
 * strings and lists the dependency factory produces, so they are exercised
 * against stub collaborators rather than a database.
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { ProjectService } from "../../projects/project.service";
import type { EmailSuppressionService } from "../emailSuppression.service";
import { defaultRunawayContainmentDeps } from "../runaway-containment.deps";
import type { TriggerService } from "../trigger.service";

const resolveOrganizationId =
  vi.fn<(projectId: string) => Promise<string | undefined>>();

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: (projectId: string) =>
    resolveOrganizationId(projectId),
}));

// A mutable holder read by `makeDeps()`, so a test can pick the path it
// exercises: null is the per-worker fallback, an object is Redis.
const redisMock = vi.hoisted(() => ({ connection: undefined as unknown }));

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
    redis: (redisMock.connection ?? null) as RedisConnection | null,
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

  describe("given the once-per-day claim gate", () => {
    // The claim stores are module-level, so every case needs a key of its own.
    const freshKey = () => `automation-cap-mail:${nanoid(8)}`;

    describe("when a second worker claims a key another worker holds", () => {
      it("hands it no lease", async () => {
        const deps = makeDeps();
        const key = freshKey();

        expect(await deps.claimOnce(key, 60)).not.toBeNull();
        expect(await deps.claimOnce(key, 60)).toBeNull();
      });
    });

    describe("when the holder releases the claim it took", () => {
      it("puts the key back in reach of the next attempt", async () => {
        const deps = makeDeps();
        const key = freshKey();

        const lease = await deps.claimOnce(key, 60);
        await deps.releaseClaim(lease!);

        expect(await deps.claimOnce(key, 60)).not.toBeNull();
      });
    });

    describe("when a lease releases a key the fleet has since retaken", () => {
      /** @scenario "A stale claim release never frees another worker's claim" */
      it("leaves the current holder's claim standing", async () => {
        const deps = makeDeps();
        const key = freshKey();

        // The shape this guards: a worker claims while Redis is unreachable,
        // Redis comes back, another worker claims the key and mails on it, and
        // only then does the first worker's send fail and release.
        const stale = await deps.claimOnce(key, 60);
        await deps.releaseClaim(stale!);
        expect(await deps.claimOnce(key, 60)).not.toBeNull();

        await deps.releaseClaim(stale!);

        expect(await deps.claimOnce(key, 60)).toBeNull();
      });
    });

    describe("when Redis is the store", () => {
      afterEach(() => {
        redisMock.connection = undefined;
      });

      it("releases by compare-and-delete on its own token", async () => {
        const del = vi.fn();
        const evaluate = vi.fn().mockResolvedValue(1);
        redisMock.connection = {
          set: vi.fn().mockResolvedValue("OK"),
          del,
          eval: evaluate,
        };
        const key = freshKey();

        const deps = makeDeps();
        const lease = await deps.claimOnce(key, 60);
        await deps.releaseClaim(lease!);

        expect(del).not.toHaveBeenCalled();
        expect(evaluate).toHaveBeenCalledWith(
          expect.stringContaining("redis.call('DEL', KEYS[1])"),
          1,
          key,
          lease!.token,
        );
      });
    });
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
        resolveOrganizationId.mockResolvedValue(undefined);

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
