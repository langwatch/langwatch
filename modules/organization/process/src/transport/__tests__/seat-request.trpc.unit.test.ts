/**
 * @vitest-environment node
 *
 * `seatRequest.*` on organization's router: listing asks seatRequests:view, approving and
 * declining ask seatRequests:manage, and the waiting screen's read asks nothing.
 */
import { bindTrpcMiddlewareContext, createTrpcRuntime } from "@langwatch/api/trpc";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";

import { organizationSessionPersonContext } from "../organization.trpc.ts";
import { seatRequestTrpcTransport } from "../seat-request.trpc.ts";

type TestContext = {
  actor: { id: string };
  person: { name: string | null; email: string | null } | null;
};

const asked: string[] = [];
const granted = new Set<string>();
const approvals: Parameters<OrganizationApi["approveSeatRequest"]>[] = [];
const declines: Parameters<OrganizationApi["declineSeatRequest"]>[] = [];

const members = trpcTestMembers<TestContext>({
  permits: (permission) => {
    asked.push(permission);
    return granted.has(permission);
  },
});

const app = createApiFixture<OrganizationApi>({
  approveSeatRequest: async (...args: Parameters<OrganizationApi["approveSeatRequest"]>) => {
    approvals.push(args);
    return { outcome: "enabled" };
  },
  declineSeatRequest: async (...args: Parameters<OrganizationApi["declineSeatRequest"]>) => {
    declines.push(args);
    return { outcome: "declined" };
  },
  listOpenSeatRequests: async () => ({
    requests: [],
    seatFree: true,
    approvalPath: { kind: "upgrade_plan", url: "/settings/subscription" },
  }),
  getHeldMemberships: async () => ({ hasActiveMembership: false, held: [] }),
});
const trpc = initTRPC.context<TestContext>().create();
const router = createTrpcRuntime<TestContext>({
  root: trpc,
  procedure: trpc.procedure,
  members,
}).mount(seatRequestTrpcTransport, () => app, {
  middlewareContext: [
    bindTrpcMiddlewareContext(organizationSessionPersonContext, (ctx) => ctx.person),
  ],
});
const caller = router.createCaller({
  actor: { id: "user_ada" },
  person: { name: "Ada Admin", email: "ada@acme.example" },
});
const scope = { organizationId: "org_acme", seatRequestId: "seatrequest_1" };

describe("seatRequest on organization's router", () => {
  beforeEach(() => {
    asked.length = 0;
    approvals.length = 0;
    declines.length = 0;
    granted.clear();
  });

  it("exposes exactly the procedure names the clients call", () => {
    expect(Object.keys(router._def.procedures).toSorted()).toEqual([
      "approve",
      "decline",
      "listOpen",
      "myHeldMemberships",
    ]);
  });

  describe("when a member without seatRequests:manage approves", () => {
    /** @scenario "A person without the seat request permission cannot approve" */
    it("refuses with permission_denied before the application is asked", async () => {
      await expect(caller.approve(scope)).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "permission_denied" }),
      });
      expect(asked).toEqual(["seatRequests:manage"]);
      expect(approvals).toEqual([]);
    });
  });

  describe("when an administrator holding seatRequests:manage approves", () => {
    it("forwards the request and the caller", async () => {
      granted.add("seatRequests:manage");

      await expect(caller.approve(scope)).resolves.toEqual({ outcome: "enabled" });
      expect(approvals).toEqual([
        [scope, { id: "user_ada", name: "Ada Admin", email: "ada@acme.example" }],
      ]);
    });
  });

  describe("when a member lists the open seat requests", () => {
    it("refuses without seatRequests:view", async () => {
      await expect(caller.listOpen({ organizationId: "org_acme" })).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "permission_denied" }),
      });
      expect(asked).toEqual(["seatRequests:view"]);
    });

    it("answers with seatRequests:view", async () => {
      granted.add("seatRequests:view");

      await expect(caller.listOpen({ organizationId: "org_acme" })).resolves.toMatchObject({
        requests: [],
      });
    });
  });

  describe("when a member declines a seat request", () => {
    it("refuses without seatRequests:manage before the application is asked", async () => {
      await expect(caller.decline(scope)).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "permission_denied" }),
      });
      expect(asked).toEqual(["seatRequests:manage"]);
      expect(declines).toEqual([]);
    });

    it("forwards the request and the caller with seatRequests:manage", async () => {
      granted.add("seatRequests:manage");

      await expect(caller.decline(scope)).resolves.toEqual({ outcome: "declined" });
      expect(declines).toEqual([
        [scope, { id: "user_ada", name: "Ada Admin", email: "ada@acme.example" }],
      ]);
    });
  });

  describe("when a held person reads their held memberships", () => {
    it("asks no permission", async () => {
      await expect(caller.myHeldMemberships({})).resolves.toEqual({
        hasActiveMembership: false,
        held: [],
      });
      expect(asked).toEqual([]);
    });
  });
});
