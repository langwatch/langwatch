import { describe, expect, it } from "vitest";
import {
  resolveHomeDestination,
  type HomeDestinationInput,
} from "../resolveHomeDestination";

const base: HomeDestinationInput = {
  resolverDestination: "/me",
  isOverride: false,
  intentPinned: false,
  governanceUiEnabled: true,
  lastVisitedHomeKind: "",
  lastProjectSlug: null,
};

describe("resolveHomeDestination", () => {
  describe("when the user has no visit history", () => {
    it("uses the persona resolver's destination", () => {
      expect(
        resolveHomeDestination({ ...base, resolverDestination: "/me" }),
      ).toBe("/me");
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
        }),
      ).toBe("/acme");
    });
  });

  describe("when the persona default is /me but the user last opened a project", () => {
    /** @scenario "A last-visited project sticks over the persona /me default" */
    it("sticks to that project instead of /me", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          lastVisitedHomeKind: "project",
          lastProjectSlug: "inbox-narrator",
        }),
      ).toBe("/inbox-narrator");
    });

    it("also overrides a /governance default for an admin who last opened a project", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/governance",
          lastVisitedHomeKind: "project",
          lastProjectSlug: "inbox-narrator",
        }),
      ).toBe("/inbox-narrator");
    });

    it("falls back to the resolver destination when there is no project to return to", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          lastVisitedHomeKind: "project",
          lastProjectSlug: null,
        }),
      ).toBe("/me");
    });
  });

  describe("when the user last sat on /me", () => {
    it("sticks to /me over a project-home persona default", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
          lastVisitedHomeKind: "personal",
        }),
      ).toBe("/me");
    });

    it("does not force /me when the governance UI is unreachable for the org", () => {
      // /me 404s without the flag, so an impersonated non-governance customer
      // whose admin's localStorage says "personal" must keep the project home.
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
          lastVisitedHomeKind: "personal",
          governanceUiEnabled: false,
        }),
      ).toBe("/acme");
    });
  });

  describe("when the org intent pinned the destination (ADR-038)", () => {
    /** @scenario "Last-visited stickiness does not override the organization intent" */
    it("keeps /me even when the user last opened a project", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          intentPinned: true,
          lastVisitedHomeKind: "project",
          lastProjectSlug: "inbox-narrator",
        }),
      ).toBe("/me");
    });

    it("keeps a project-kind destination when the user last sat on /me", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
          intentPinned: true,
          lastVisitedHomeKind: "personal",
        }),
      ).toBe("/acme");
    });

    it("still substitutes the last-visited project within the project kind", () => {
      // Intent decides the KIND of home, not which project (Decision 3).
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/first-membership-project",
          intentPinned: true,
          lastVisitedHomeKind: "project",
          lastProjectSlug: "inbox-narrator",
        }),
      ).toBe("/inbox-narrator");
    });

    it("keeps the resolver's project fallback for a kill-switched governance org", () => {
      // I8: server already resolved the fallback; nothing may re-flip to /me.
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
          intentPinned: true,
          governanceUiEnabled: false,
          lastVisitedHomeKind: "personal",
        }),
      ).toBe("/acme");
    });
  });

  describe("when the user set an explicit picker pin", () => {
    /** @scenario "An explicit picker pin still wins over the last-visited project" */
    it("honors the pin even over a last-visited project", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          isOverride: true,
          lastVisitedHomeKind: "project",
          lastProjectSlug: "inbox-narrator",
        }),
      ).toBe("/me");
    });
  });
});
