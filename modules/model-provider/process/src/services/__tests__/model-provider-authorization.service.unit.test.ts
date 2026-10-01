// Pins the permission mapping rather than asserting it's right — three places currently answer
// this question and disagree on PROJECT (`project:update` vs `project:manage`), so this test
// exists to make drift between them a deliberate edit, not a silent divergence.

import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { ModelProviderAuthorizationService } from "../model-provider-authorization.service.ts";

/** Records what was asked of authz, and answers however the test wants. */
function recordingAuthz(permitted: boolean) {
  const asked: { permission: string; tier: string; id: string }[] = [];
  const authz = createApiFixture<AuthzApi>({
    getDecision: async (input) => {
      asked.push({
        permission: input.permission,
        tier: input.scope.tier,
        id: input.scope.id,
      });
      return { permitted, organizationRole: null };
    },
  });

  return { asked, service: ModelProviderAuthorizationService.create(authz) };
}

const scope = (scopeType: ModelDefaultScope["scopeType"]): ModelDefaultScope =>
  ({ scopeType, scopeId: `${scopeType.toLowerCase()}-1` }) as ModelDefaultScope;

describe("ModelProviderAuthorizationService.canWrite", () => {
  describe("given the permission it asks authz for", () => {
    it.each([
      ["ORGANIZATION", "organization:manage"],
      ["TEAM", "team:manage"],
      // Member-level, and deliberately pinned: the route that reaches this
      // declares `project:manage`, which is admin-level.
      ["PROJECT", "project:update"],
    ])("asks for %s writes with %s", async (scopeType, expected) => {
      const { asked, service } = recordingAuthz(true);

      await service.canWrite("user-1", scope(scopeType as ModelDefaultScope["scopeType"]));

      expect(asked[0]?.permission).toBe(expected);
    });

    it("is the same permission the refusal would name", () => {
      // The write-assert service builds its error from `writePermission`, so
      // this equality is what stops a refusal naming a permission that was
      // never the one checked.
      const { asked, service } = recordingAuthz(true);

      return service.canWrite("user-1", scope("PROJECT")).then(() => {
        expect(asked[0]?.permission).toBe(
          ModelProviderAuthorizationService.writePermission("PROJECT"),
        );
      });
    });
  });

  describe("given the scope it asks about", () => {
    it("lowercases the tier and passes the id through", async () => {
      const { asked, service } = recordingAuthz(true);

      await service.canWrite("user-1", scope("ORGANIZATION"));

      expect(asked[0]).toMatchObject({ tier: "organization", id: "organization-1" });
    });
  });

  describe("given what authz answers", () => {
    it("passes the decision through rather than reinterpreting it", async () => {
      await expect(recordingAuthz(true).service.canWrite("u", scope("TEAM"))).resolves.toBe(true);
      await expect(recordingAuthz(false).service.canWrite("u", scope("TEAM"))).resolves.toBe(false);
    });
  });
});

describe("ModelProviderAuthorizationService.canRead", () => {
  it.each([
    ["ORGANIZATION", "organization:view"],
    ["TEAM", "team:view"],
    ["PROJECT", "project:view"],
  ])("asks for %s reads with %s", async (scopeType, expected) => {
    const { asked, service } = recordingAuthz(true);

    await service.canRead("user-1", scope(scopeType as ModelDefaultScope["scopeType"]));

    expect(asked[0]?.permission).toBe(expected);
  });

  it("never asks for a write permission on a read", async () => {
    const { asked, service } = recordingAuthz(true);

    await service.canRead("user-1", scope("PROJECT"));

    expect(asked[0]?.permission).not.toBe(
      ModelProviderAuthorizationService.writePermission("PROJECT"),
    );
  });
});
