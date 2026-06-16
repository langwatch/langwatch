import { describe, expect, it } from "vitest";
import {
  resolveHomeDestination,
  type HomeDestinationInput,
} from "../resolveHomeDestination";

const base: HomeDestinationInput = {
  resolverDestination: "/me",
  isOverride: false,
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

  describe("when an organization slug is supplied for an org-scoped home", () => {
    // Regression: a fresh-login user whose selected project drifted to a
    // non-governance org landed on /me and 404'd behind the feature-flag guard.
    // Carrying ?org=<slug> lets the page re-pin to the resolver's org.
    it("carries ?org=<slug> onto a /me destination", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          organizationSlug: "acme",
        }),
      ).toBe("/me?org=acme");
    });

    it("carries ?org=<slug> onto a /governance destination", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/governance",
          organizationSlug: "acme",
        }),
      ).toBe("/governance?org=acme");
    });

    it("carries ?org=<slug> onto /me even when forced by an explicit pin", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          isOverride: true,
          organizationSlug: "acme",
        }),
      ).toBe("/me?org=acme");
    });

    it("carries ?org=<slug> onto /me forced by a personal last-visit", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/acme",
          lastVisitedHomeKind: "personal",
          organizationSlug: "acme",
        }),
      ).toBe("/me?org=acme");
    });

    it("url-encodes a slug with reserved characters", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          organizationSlug: "acme org/eu",
        }),
      ).toBe("/me?org=acme%20org%2Feu");
    });

    it("leaves a project-home destination untouched", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/inbox-narrator",
          organizationSlug: "acme",
        }),
      ).toBe("/inbox-narrator");
    });

    it("appends no param when the org slug is null or absent", () => {
      expect(
        resolveHomeDestination({
          ...base,
          resolverDestination: "/me",
          organizationSlug: null,
        }),
      ).toBe("/me");
      expect(
        resolveHomeDestination({ ...base, resolverDestination: "/me" }),
      ).toBe("/me");
    });
  });
});
