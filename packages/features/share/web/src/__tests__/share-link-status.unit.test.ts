import type { ShareLink } from "@langwatch/share-contract";
import { describe, expect, it } from "vitest";
import { describeShareLink, isShareLinkSpent } from "../share-link-status";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function buildLink(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: "share_1",
    token: "tok_1",
    resourceType: "TRACE",
    resourceId: "trace_1",
    threadId: null,
    projectId: "project_1",
    userId: null,
    visibility: "PUBLIC",
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("share link status", () => {
  describe("given a link with no expiry and no view cap", () => {
    it("is never spent", () => {
      expect(isShareLinkSpent({ link: buildLink(), now: NOW })).toBe(false);
    });

    it("reads as having no expiry", () => {
      expect(describeShareLink({ link: buildLink(), now: NOW })).toBe("No expiry");
    });
  });

  describe("given a link whose expiry has passed", () => {
    it("is spent", () => {
      const link = buildLink({ expiresAt: new Date(NOW.getTime() - 1) });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(true);
    });

    it("reads as expired", () => {
      const link = buildLink({ expiresAt: new Date(NOW.getTime() - 1) });
      expect(describeShareLink({ link, now: NOW })).toBe("Expired");
    });
  });

  describe("given a link expiring exactly now", () => {
    // The service treats `expiresAt <= now` as expired; the row must not read
    // as live while the server refuses it.
    it("is already spent", () => {
      const link = buildLink({ expiresAt: new Date(NOW.getTime()) });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(true);
    });
  });

  describe("given a one-time link", () => {
    it("reads as unopened before its single view", () => {
      const link = buildLink({ maxViews: 1, viewCount: 0 });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(false);
      expect(describeShareLink({ link, now: NOW })).toBe("Opens once · No expiry");
    });

    it("reads as opened once its view is consumed", () => {
      const link = buildLink({ maxViews: 1, viewCount: 1 });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(true);
      expect(describeShareLink({ link, now: NOW })).toBe("Opened · No expiry");
    });
  });

  describe("given a link with a multi-view budget", () => {
    it("reports the budget it has left", () => {
      const link = buildLink({ maxViews: 5, viewCount: 2 });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(false);
      expect(describeShareLink({ link, now: NOW })).toBe("2 of 5 views · No expiry");
    });

    it("is spent once the count reaches the cap", () => {
      const link = buildLink({ maxViews: 5, viewCount: 5 });
      expect(isShareLinkSpent({ link, now: NOW })).toBe(true);
    });
  });
});
