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

    /** @scenario "Links created before permissions existed are unchanged" */
    it("check() walks token collection through to a public grant", async () => {
      // `liveShareLinkRow` carries NO permission key at all — the shape a row
      // written before the column existed has. It must keep answering exactly
      // as it did, which is what the two assertions below and the annotate
      // refusal further down together say.
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

    /** @scenario "A view-only link cannot annotate the trace it shows" */
    it("refuses to annotate — the link says view and nothing else", async () => {
      const decision = await authzWithLink().check({
        principal: { type: "anonymous" },
        permission: "annotations:create",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(false);
    });
  });

  describe("given a live public link that states annotations:create", () => {
    const authzWithAnnotateLink = () =>
      new AuthzService(
        new AuthzCollectorService(
          makeReader({
            findShareLinks: vi
              .fn()
              .mockResolvedValue([
                { ...liveShareLinkRow, permission: "annotations:create" },
              ]),
          }),
        ),
      );

    /** @scenario "An annotate link lets its holder annotate the shared trace" */
    it("admits the annotation the link names, through the resource tier", async () => {
      const decision = await authzWithAnnotateLink().check({
        principal: { type: "anonymous" },
        permission: "annotations:create",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    /** @scenario "An annotate link also lets its holder read the trace" */
    it("still admits the read — annotating what you cannot see grants nothing", async () => {
      const decision = await authzWithAnnotateLink().check({
        principal: { type: "anonymous" },
        permission: "traces:view",
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(decision.allowed).toBe(true);
    });

    /** @scenario "An annotate link confers nothing beyond reading and commenting" */
    it("does not widen past the two it names", async () => {
      const permissions = await authzWithAnnotateLink().effectivePermissions({
        principal: { type: "anonymous" },
        scope: traceScope({ shareTokens: ["tok-1"] }),
      });
      expect(permissions).toEqual(["traces:view", "annotations:create"]);
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
