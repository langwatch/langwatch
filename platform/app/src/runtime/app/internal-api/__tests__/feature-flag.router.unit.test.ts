/**
 * The process policy wrapped around the package-owned feature flag transport:
 * the surface stays authenticated, its access decision stays declared so the
 * fail-closed backstop is satisfied, and the procedure names remain the
 * compatibility contract the browser calls.
 *
 * @vitest-environment node
 */
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { describe, expect, it } from "vitest";
import { featureFlagRouter } from "../feature-flag.router";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { createInnerTRPCContext } from "~/server/api/trpc";

const FLAG = "release_ui_ai_governance_enabled";

function buildContext(session: { user: { id: string }; expires: string } | null) {
  const featureFlags = MemoryFeatureFlagService.create();
  featureFlags.setFlag(FLAG, true);
  const app = { featureFlags } as unknown as RequestAppServices;

  return createInnerTRPCContext({
    app,
    session,
    permissionChecked: false,
    publiclyShared: false,
  });
}

describe("feature flag transport mount", () => {
  describe("given the composed router", () => {
    it("keeps the legacy procedure names the browser calls", () => {
      const procedures = (
        featureFlagRouter as unknown as { _def: { procedures: Record<string, unknown> } }
      )._def.procedures;

      expect(Object.keys(procedures).sort()).toEqual([
        "experiments",
        "isEnabled",
        "isEnabledForAnyOrganization",
        "isEnabledForEachOrganization",
        "resolve",
        "setExperimentEnrolment",
        "setExperimentTenantPolicy",
      ]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the feature resolver runs", async () => {
      const caller = featureFlagRouter.createCaller(buildContext(null));

      await expect(caller.isEnabled({ flag: FLAG })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("when the caller is signed in", () => {
    it("passes the declared access decision and reaches the feature service", async () => {
      const caller = featureFlagRouter.createCaller(
        buildContext({ user: { id: "user_1" }, expires: "1" }),
      );

      await expect(caller.isEnabled({ flag: FLAG })).resolves.toEqual({ enabled: true });
    });
  });
});
