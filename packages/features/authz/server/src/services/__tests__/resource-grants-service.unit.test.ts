import { GrantValidationError } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import type { EventingAuthzLedgerAdapter } from "../../adapters/eventing.authz-ledger.adapter";
import type { AuthzGrantRepository } from "../../repositories/authz-grant.repository";
import { AuthzGrantsService } from "../authz-grants.service";
import { AuthzService } from "../authz.service";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { StubAuthzEpoch } from "../../ports/__tests__/support/authz-epoch.stub";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub";
import { liveShareLinkRow, ORG, traceScope } from "./support/resource-fixtures";

describe("AuthzService on a resource scope", () => {
  describe("given a live public share link for trace t1 and no session", () => {
    const authzWithLink = () =>
      AuthzService.create({
        // These suites exercise the engine path, which is what the absent
        // gate used to default to.
        isOnEngine: async () => true,
        listing: new StubAuthzListingRepository(),
        bindings: new StubAuthzBindingRepository(),
        repository: makeReader({
          findShareLinks: vi.fn().mockResolvedValue([liveShareLinkRow]),
        }),
      });

    it("check() walks token collection through to a public grant", async () => {
      const decision = await authzWithLink().check({
        principal: { type: "anonymous" },
        permission: "traces:view",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    it("effectivePermissions() is exactly the shared permission", async () => {
      const permissions = await authzWithLink().effectivePermissions({
        principal: { type: "anonymous" },
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(permissions).toEqual(["traces:view"]);
    });
  });
});

describe("AuthzGrantsService and resource scopes", () => {
  const makeService = () =>
    AuthzGrantsService.create({
      repository: {} as AuthzGrantRepository,
      ledger: {} as EventingAuthzLedgerAdapter,
      epoch: new StubAuthzEpoch(),
      newBindingId: () => "rb_test",
      bindings: new StubAuthzBindingRepository(),
    });

  describe("when a role binding is attached at a resource scope", () => {
    /** @scenario "Resource-tier access is granted by sharing, never by a role binding" */
    it("rejects before touching storage — shares are not bindings", async () => {
      await expect(
        makeService().attach({
          actor: { userId: "admin-1" },
          who: { type: "user", id: "user-1" },
          role: { builtin: "MEMBER" },
          where: traceScope(),
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });

    it("rejects replace() toward a resource scope the same way", async () => {
      await expect(
        makeService().replace({
          actor: { userId: "admin-1" },
          who: { type: "user", id: "user-1" },
          from: { type: "organization", id: ORG },
          to: traceScope(),
          role: { builtin: "MEMBER" },
        }),
      ).rejects.toBeInstanceOf(GrantValidationError);
    });

    it("names the resource without leaking the stage note into the message", async () => {
      const attaching = makeService().attach({
        actor: { userId: "admin-1" },
        who: { type: "user", id: "user-1" },
        role: { builtin: "MEMBER" },
        where: traceScope(),
      });

      await expect(attaching).rejects.toMatchObject({
        code: "grant_validation_failed",
        meta: { kind: "trace", resourceId: "trace-1" },
      });
      // The migration note lives in the source comment, never in the
      // sentence an admin reads.
      const rejection = (await attaching.catch((error: unknown) => error)) as GrantValidationError;
      expect(rejection.message).not.toContain("C5");
      expect(rejection.message).not.toContain("stage");
    });
  });
});
