/**
 * @vitest-environment node
 * Whether a page open is auth's to announce: only a browser login session of a person who
 * belongs to an organization, and never at the cost of the page.
 * @see modules/auth/specs/app-page-opened.feature
 */
import { describe, expect, it } from "vitest";

import { AppPageOpenedService } from "../auth-lifecycle-notice.service.ts";

function serviceOver({
  memberships = async () => 1,
  appPageOpened = () => undefined,
}: {
  memberships?: () => Promise<number>;
  appPageOpened?: (input: { userId: string; page: "me_sessions" }) => void;
} = {}) {
  const opened: { userId: string; page: "me_sessions" }[] = [];
  const reported: unknown[] = [];
  const service = AppPageOpenedService.create({
    organizations: { countMembershipsForUser: memberships },
    lifecycle: {
      appPageOpened: (input) => {
        opened.push(input);
        appPageOpened(input);
      },
    },
    reportError: (error) => void reported.push(error),
  });
  return { service, opened, reported };
}

describe("AppPageOpenedService", () => {
  describe("given a browser session of a person with an organization", () => {
    /** @scenario "A browser session opening the page records the fact" */
    it("records the open for the person and the page", async () => {
      const { service, opened } = serviceOver();

      await service.record({
        userId: "user_ada",
        browserSessionId: "session-1",
        page: "me_sessions",
      });

      expect(opened).toEqual([{ userId: "user_ada", page: "me_sessions" }]);
    });
  });

  describe("given a caller with no browser session", () => {
    /** @scenario "A call without a browser session records nothing" */
    it("records nothing", async () => {
      const { service, opened } = serviceOver();

      await service.record({ userId: "user_ada", browserSessionId: null, page: "me_sessions" });

      expect(opened).toEqual([]);
    });
  });

  describe("given a person with no organization membership", () => {
    /** @scenario "A person with no organization membership records nothing" */
    it("records nothing", async () => {
      const { service, opened } = serviceOver({ memberships: async () => 0 });

      await service.record({
        userId: "user_ada",
        browserSessionId: "session-1",
        page: "me_sessions",
      });

      expect(opened).toEqual([]);
    });
  });

  describe("when the membership read or the record fails", () => {
    /** @scenario "A failing record never fails the page open" */
    it("resolves when the membership read throws", async () => {
      const { service } = serviceOver({
        memberships: async () => {
          throw new Error("database unavailable");
        },
      });

      await expect(
        service.record({ userId: "user_ada", browserSessionId: "session-1", page: "me_sessions" }),
      ).resolves.toBeUndefined();
    });

    it("resolves when the lifecycle recorder throws", async () => {
      const { service } = serviceOver({
        appPageOpened: () => {
          throw new Error("event store unavailable");
        },
      });

      await expect(
        service.record({ userId: "user_ada", browserSessionId: "session-1", page: "me_sessions" }),
      ).resolves.toBeUndefined();
    });

    it("reports the failure", async () => {
      const { service, reported } = serviceOver({
        memberships: async () => {
          throw new Error("database unavailable");
        },
      });

      await service.record({
        userId: "user_ada",
        browserSessionId: "session-1",
        page: "me_sessions",
      });

      expect(reported).toHaveLength(1);
    });
  });
});
