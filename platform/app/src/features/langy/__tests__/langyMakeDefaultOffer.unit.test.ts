/**
 * The "make it the default?" decision: picking a model in the composer earns
 * the ask only when the current Langy default is CONFIGURED at a scope the
 * picker can manage, and a yes writes at that same scope and kind. Everything
 * else — no configured default, picking the default itself, no rights at the
 * holding scope — asks nothing.
 */
import { describe, expect, it } from "vitest";

import { makeDefaultOffer } from "../logic/langyMakeDefaultOffer";

const SCOPE_IDS = {
  organizationId: "org-1",
  teamId: "team-1",
  projectId: "proj-1",
};
const NO_RIGHTS = { organization: false, team: false, project: false };
const ALL_RIGHTS = { organization: true, team: true, project: true };

describe("makeDefaultOffer", () => {
  describe("given no configured default (the resolver inferred one)", () => {
    it("asks nothing", () => {
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5-mini",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "inferred",
            scope: null,
          },
          canManage: ALL_RIGHTS,
          scopeIds: SCOPE_IDS,
        }),
      ).toBeNull();
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5-mini",
          resolvedDefault: null,
          canManage: ALL_RIGHTS,
          scopeIds: SCOPE_IDS,
        }),
      ).toBeNull();
    });
  });

  describe("given the user picked the default itself", () => {
    it("asks nothing", () => {
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "role_default",
            scope: "organization",
          },
          canManage: ALL_RIGHTS,
          scopeIds: SCOPE_IDS,
        }),
      ).toBeNull();
    });
  });

  describe("given an organization-level default", () => {
    /** @scenario Picking a model offers to make it the default at the scope that holds it */
    it("plans an organization write for an organization admin", () => {
      expect(
        makeDefaultOffer({
          picked: "custom/stealth/ox-alpha",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "role_default",
            scope: "organization",
          },
          canManage: { ...NO_RIGHTS, organization: true },
          scopeIds: SCOPE_IDS,
        }),
      ).toEqual({
        kind: "role-default",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        scopeLabel: "organization",
        model: "custom/stealth/ox-alpha",
      });
    });

    /** @scenario No default offer without the right to change it */
    it("asks nothing without organization manage rights", () => {
      expect(
        makeDefaultOffer({
          picked: "custom/stealth/ox-alpha",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "role_default",
            scope: "organization",
          },
          canManage: { ...NO_RIGHTS, team: true, project: true },
          scopeIds: SCOPE_IDS,
        }),
      ).toBeNull();
    });
  });

  describe("given a team-level default and team manage rights", () => {
    it("plans a team write", () => {
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5-mini",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "role_default",
            scope: "team",
          },
          canManage: { ...NO_RIGHTS, team: true },
          scopeIds: SCOPE_IDS,
        }),
      ).toMatchObject({ scopeType: "TEAM", scopeId: "team-1" });
    });
  });

  describe("given a project-level default and project update rights", () => {
    it("plans a project write", () => {
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5-mini",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "role_default",
            scope: "project",
          },
          canManage: { ...NO_RIGHTS, project: true },
          scopeIds: SCOPE_IDS,
        }),
      ).toMatchObject({ scopeType: "PROJECT", scopeId: "proj-1" });
    });
  });

  describe("given the default came from a feature override", () => {
    it("plans a feature-override write, mirroring what it replaces", () => {
      expect(
        makeDefaultOffer({
          picked: "openai/gpt-5-mini",
          resolvedDefault: {
            model: "openai/gpt-5",
            source: "feature_override",
            scope: "project",
          },
          canManage: ALL_RIGHTS,
          scopeIds: SCOPE_IDS,
        }),
      ).toMatchObject({ kind: "feature-override" });
    });
  });
});
