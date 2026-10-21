/**
 * A REST route asking a permission at each of several route targets: the door asks every one
 * before the handler, and mints a proof per proof-bearing target. Spec:
 * packages/api/specs/permission-targets.feature; ADR-183 §2, §7.
 */
import {
  type Authorization,
  type AuthzPermission,
  type ProofBearingPermission,
  sealAuthorization,
} from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type BraidsApi = { preview(input: { ownerProjectId: string }): Promise<{ ok: boolean }> };

const BraidsApi = moduleApi<BraidsApi>()("authz");
const VERSION = "2026-10-21";
const OWNER = { at: "route", param: "projectId", field: "ownerProjectId" } as const;
const READER = { at: "route", param: "projectId", field: "readerProjectId" } as const;
const PATH_PARAMS = z.object({ ownerProjectId: z.string(), readerProjectId: z.string() });

function proofFor({ projectId, permission }: { projectId: string; permission: AuthzPermission }) {
  return sealAuthorization({
    actor: { type: "user", id: "user_sam" },
    principal: { type: "user", id: "user_sam" },
    scope: { organizationId: "org_acme" },
    grants: [{ projectId, permissions: [permission], via: [], kind: "own" }],
    expiresAt: Number.MAX_SAFE_INTEGER,
    purpose: { kind: "route", route: "braids.preview" },
  });
}

function mounted({
  first,
  second,
  held,
}: {
  first: AuthzPermission;
  second: ProofBearingPermission | AuthzPermission;
  held: ReadonlySet<string>;
}) {
  const asked: string[] = [];
  const ran: string[] = [];
  const handed: (Readonly<Record<string, Authorization>> | undefined)[] = [];
  const caller = {
    actor: { type: "user", id: "user_sam" },
    scope: { tier: "organization", id: "org_acme" },
  } as const;
  const door: RestIdentity = {
    authenticate: () => caller,
    identify: () => caller,
    authorize: async ({ permission, target }) => {
      asked.push(`${permission}@${target.id}`);

      return { permitted: held.has(`${permission}@${target.id}`), organizationRole: "MEMBER" };
    },
  };
  const routes = defineRestRouter(BraidsApi)
    .withNamespace("braids")
    .withVersion(VERSION)
    .withCredential("organization")
    .get("/:ownerProjectId/into/:readerProjectId", "preview")
    .withParams(PATH_PARAMS)
    .withPermission(first, OWNER)
    .withPermission(second, READER)
    .withOutput(z.object({ ok: z.boolean() }))
    .handle((args) => {
      handed.push(
        (args as { authorizations?: Readonly<Record<string, Authorization>> }).authorizations,
      );

      return args.app.preview({ ownerProjectId: args.input.ownerProjectId });
    })
    .build()
    .router();
  const app: BraidsApi = {
    preview: async ({ ownerProjectId }) => {
      ran.push(ownerProjectId);

      return { ok: true };
    },
  };
  const server = createRestRuntime({
    identity: door,
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        projectKindOf: async () => "application",
        authorization: async ({ permission, projectId }) => proofFor({ projectId, permission }),
      }),
    },
  }).mount(routes, { app: () => app, onError: createErrorHandler() });

  return {
    asked,
    ran,
    handed,
    request: () =>
      server.request(`/api/braids/${VERSION}/proj_owner/into/proj_reader`, {
        headers: { authorization: "Bearer k" },
      }),
  };
}

describe("a REST route asking a permission at two route targets", () => {
  describe("when the caller holds both", () => {
    /** @scenario "A route asking two targets serves a caller holding both" */
    it("asks the owner, then the reader, and runs the handler", async () => {
      const route = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["project:view@proj_owner", "traces:view@proj_reader"]),
      });

      expect((await route.request()).status).toBe(200);
      expect(route.asked).toEqual(["project:view@proj_owner", "traces:view@proj_reader"]);
      expect(route.ran).toEqual(["proj_owner"]);
    });
  });

  describe("when the reader refuses the caller", () => {
    /** @scenario "A route refuses a caller the second target refuses, before its handler" */
    it("answers 403 permission_denied and never runs the handler", async () => {
      const route = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["project:view@proj_owner"]),
      });

      const response = await route.request();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
      expect(route.asked).toEqual(["project:view@proj_owner", "traces:view@proj_reader"]);
      expect(route.ran).toEqual([]);
    });
  });

  describe("when the owner refuses the caller", () => {
    /** @scenario "A route refuses a caller the first target refuses, before its handler" */
    it("answers 403 permission_denied without asking the reader or running the handler", async () => {
      const route = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["traces:view@proj_reader"]),
      });

      const response = await route.request();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
      expect(route.asked).toEqual(["project:view@proj_owner"]);
      expect(route.ran).toEqual([]);
    });
  });

  describe("when both targets ask a proof-bearing permission", () => {
    /** @scenario "A route's handler is handed one proof per proof-bearing target" */
    it("hands the handler a proof for each project, by the field naming it", async () => {
      const route = mounted({
        first: "traces:view",
        second: "traces:view",
        held: new Set(["traces:view@proj_owner", "traces:view@proj_reader"]),
      });

      expect((await route.request()).status).toBe(200);

      const proofs = route.handed[0];
      expect(proofs?.ownerProjectId?.grants[0]?.projectId).toBe("proj_owner");
      expect(proofs?.readerProjectId?.grants[0]?.projectId).toBe("proj_reader");
    });

    /** @scenario "A route's handler is handed one proof per proof-bearing target" */
    it("types each proof by its field, beside the first target's own proof", () => {
      const declare = () =>
        defineRestRouter(BraidsApi)
          .withNamespace("braids-typed")
          .withVersion(VERSION)
          .withCredential("organization")
          .get("/:ownerProjectId/into/:readerProjectId", "preview")
          .withParams(PATH_PARAMS)
          .withPermission("traces:view", OWNER)
          .withPermission("traces:view", READER)
          .withOutput(z.object({ ok: z.boolean() }))
          .handle(({ app, authorization, authorizations }) => {
            const proofs: readonly Authorization[] = [
              authorization,
              authorizations.ownerProjectId,
              authorizations.readerProjectId,
            ];

            return app.preview({ ownerProjectId: String(proofs.length) });
          });

      expect(declare).not.toThrow();
    });
  });
});

describe("a second permission a route declares", () => {
  const route = () =>
    defineRestRouter(BraidsApi)
      .withNamespace("braids-declared")
      .withVersion(VERSION)
      .withCredential("organization")
      .get("/:ownerProjectId/into/:readerProjectId", "preview")
      .withParams(PATH_PARAMS);

  /** @scenario "A second permission without a route target of its own is refused at declaration" */
  it("is refused with no route target, at the same target, or after a set, a choice or none", () => {
    expect(() =>
      route().withPermission("project:view", OWNER).withPermission("traces:view"),
    ).toThrow(/declares withPermission\(\) twice/);
    expect(() =>
      route().withPermission("project:view", OWNER).withPermission("traces:view", OWNER),
    ).toThrow(/asks a permission at "ownerProjectId" twice/);
    expect(() =>
      route()
        .withPermission(["project:view", "project:update"], OWNER)
        .withPermission("traces:view", READER),
    ).toThrow(/declares withPermission\(\) twice/);
    expect(() =>
      route().withPermission("project:view").withPermission("traces:view", READER),
    ).toThrow(/declares withPermission\(\) twice/);
  });
});
