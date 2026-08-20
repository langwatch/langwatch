import { describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzGrantsRepository } from "../authz-grants.repository";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";
import { GrantValidationError } from "../grant-validation";
import { GrantsService } from "../grants.service";
import { makeReader } from "./support/authz-read.stub";
import { liveShareLinkRow, ORG, traceScope } from "./support/resource-fixtures";

describe("AuthzService on a resource scope", () => {
  describe("given a live public share link for trace t1 and no session", () => {
    const authzWithLink = () =>
      new AuthzService(
        new AuthzCollectorService(
          makeReader({
            findShareLinks: vi.fn().mockResolvedValue([liveShareLinkRow]),
          }),
        ),
      );

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

describe("GrantsService and resource scopes", () => {
  const makeService = () =>
    new GrantsService({} as AuthzGrantsRepository, {
      newBindingId: () => "rb_test",
      bumpEpoch: vi.fn().mockResolvedValue(undefined),
      collectorFor: (reader: AuthzReadRepository) =>
        new AuthzCollectorService(reader),
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
      const rejection = (await attaching.catch(
        (error: unknown) => error,
      )) as GrantValidationError;
      expect(rejection.message).not.toContain("C5");
      expect(rejection.message).not.toContain("stage");
    });
  });
});
