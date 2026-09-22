// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `scimReconciliation.getRequests` over the real runtime and a real
 * `ScimApp`: what the directory asked for, read by somebody who may see
 * single sign-on without managing it (ADR-126).
 */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { scimReconciliationTrpcTransport } from "../scim-reconciliation.trpc.ts";
import { ScimServiceFake, scimTestApp } from "./support/scim-app.fixture.ts";

type ScimTrpcTestContext = { actor: { id: string } };

const ENTRY = {
  id: "request-1",
  organizationId: "org-acme",
  connectionId: "conn-okta",
  method: "POST",
  resource: "Users",
  status: 403,
  reason: "plan_not_entitled" as const,
  detail: "Directory provisioning is not part of this plan",
  occurredAt: new Date("2026-09-22T10:00:00Z"),
};

function testPorts(
  permits: (permission: string) => boolean,
): TrpcRuntimeMembers<ScimTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function mount(permits: (permission: string) => boolean = () => true) {
  const scim = new ScimServiceFake();
  scim.findRequestLog.mockResolvedValue([ENTRY]);
  const { app } = scimTestApp({ scim });
  const trpc = initTRPC.context<ScimTrpcTestContext>().create();
  const router = createTrpcRuntime<ScimTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: testPorts(permits),
  }).mount(scimReconciliationTrpcTransport, () => app);

  return { scim, caller: router.createCaller({ actor: { id: "user-1" } }) };
}

describe("the scimReconciliation tRPC namespace", () => {
  it("answers one connection's requests, without the tenant it was asked about", async () => {
    const { scim, caller } = mount();

    await expect(
      caller.getRequests({ organizationId: "org-acme", connectionId: "conn-okta" }),
    ).resolves.toEqual([
      {
        id: "request-1",
        method: "POST",
        resource: "Users",
        status: 403,
        reason: "plan_not_entitled",
        detail: "Directory provisioning is not part of this plan",
        occurredAt: ENTRY.occurredAt,
      },
    ]);
    expect(scim.findRequestLog).toHaveBeenCalledWith({
      organizationId: "org-acme",
      connectionId: "conn-okta",
      limit: 25,
    });
  });

  /** @scenario "Reading the requests takes seeing single sign-on, and writes nothing" */
  it("takes sso:view, and nothing stronger", async () => {
    const seen: string[] = [];
    const { caller } = mount((permission) => {
      seen.push(permission);

      return permission === "sso:view";
    });

    await expect(
      caller.getRequests({ organizationId: "org-acme", connectionId: "conn-okta" }),
    ).resolves.toHaveLength(1);
    expect(seen).toEqual(["sso:view"]);
  });

  it("refuses a reader who may not see single sign-on", async () => {
    const { scim, caller } = mount(() => false);

    await expect(
      caller.getRequests({ organizationId: "org-acme", connectionId: "conn-okta" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(scim.findRequestLog).not.toHaveBeenCalled();
  });
});
