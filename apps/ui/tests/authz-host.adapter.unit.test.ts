/**
 * The AuthZ host, as this application answers it.
 *
 * The adapter is a value object over readings the provider has already made, so
 * it is constructed here rather than mounted. What is worth pinning is that it
 * PASSES THINGS THROUGH — a host that answered its own idea of the plan, or
 * dropped the raw error on the way to the feedback capability, is exactly the
 * failure a screen cannot see.
 *
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import type { AuthzFailureNotice, AuthzSuccessNotice } from "@langwatch/authz-web/screens/authz";
import { describe, expect, it, vi } from "vitest";
import { UiAuthzHost } from "../src/features/authz/behavior/authz-host.adapter";

function host(
  overrides: {
    organizationId?: string | undefined;
    isEnterprise?: boolean;
    isLoading?: boolean;
    permissions?: readonly string[];
  } = {},
) {
  const successes: AuthzSuccessNotice[] = [];
  const failures: AuthzFailureNotice[] = [];
  const adapter = UiAuthzHost.create(
    {
      scope: {
        organizationId: "organizationId" in overrides ? overrides.organizationId : "org_1",
      },
      plan: {
        isEnterprise: overrides.isEnterprise ?? true,
        isLoading: overrides.isLoading ?? false,
      },
    },
    {
      hasPermission: (permission) =>
        (overrides.permissions ?? ["organization:manage"]).includes(permission),
      succeeded: (notice) => successes.push(notice),
      failed: (failure) => failures.push(failure),
    },
  );
  return { adapter, successes, failures };
}

describe("the AuthZ host", () => {
  describe("when a screen asks what it is about", () => {
    it("answers with the organization in scope", () => {
      expect(host().adapter.scope()).toEqual({ organizationId: "org_1" });
    });

    it("carries no organization when the reader has none", () => {
      expect(host({ organizationId: void 0 }).adapter.scope()).toEqual({
        organizationId: void 0,
      });
    });
  });

  describe("when a screen asks about the plan", () => {
    /** @scenario A plan still arriving is neither Enterprise nor refused */
    it("keeps still-arriving distinct from not-Enterprise", () => {
      expect(host({ isEnterprise: false, isLoading: true }).adapter.plan()).toEqual({
        isEnterprise: false,
        isLoading: true,
      });
      expect(host({ isEnterprise: false, isLoading: false }).adapter.plan()).toEqual({
        isEnterprise: false,
        isLoading: false,
      });
    });
  });

  describe("when a screen asks about a grant", () => {
    it("answers fail-closed for a grant the reader does not hold", () => {
      const { adapter } = host({ permissions: ["organization:view"] });

      expect(adapter.hasPermission("organization:view")).toBe(true);
      expect(adapter.hasPermission("organization:manage")).toBe(false);
    });
  });

  describe("when a screen reports", () => {
    it("passes a confirmation through untouched", () => {
      const { adapter, successes } = host();

      adapter.succeeded({ title: "Role created successfully" });

      expect(successes).toEqual([{ title: "Role created successfully" }]);
    });

    /** @scenario A refusal reaches the reader as the error the server sent */
    it("passes the raw error through, never a sentence about it", () => {
      const { adapter, failures } = host();
      const refusal = new Error("validation_error");

      adapter.failed({ error: refusal, fallbackTitle: "Couldn't create role" });

      expect(failures).toEqual([{ error: refusal, fallbackTitle: "Couldn't create role" }]);
      expect(failures[0]?.error).toBe(refusal);
    });
  });

  describe("when the application's capabilities answer", () => {
    it("asks them rather than caching an answer of its own", () => {
      const hasPermission = vi.fn().mockReturnValue(true);
      const adapter = UiAuthzHost.create(
        { scope: { organizationId: "org_1" }, plan: { isEnterprise: true, isLoading: false } },
        { hasPermission, succeeded: () => {}, failed: () => {} },
      );

      adapter.hasPermission("organization:manage");
      adapter.hasPermission("organization:manage");

      expect(hasPermission).toHaveBeenCalledTimes(2);
    });
  });
});
