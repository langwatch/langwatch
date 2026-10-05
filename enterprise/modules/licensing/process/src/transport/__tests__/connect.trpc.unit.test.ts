/**
 * @vitest-environment node
 * The `connect.*` procedures over the real runtime and a real `LicensingModule`.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import type { Authorize } from "@langwatch/api/access";
import { SessionReader } from "@langwatch/api/hosting";
import { composeTrpcRouters, createTrpcRuntime, TrpcHost } from "@langwatch/api/trpc";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";

import { createTestLicensingApp } from "../../__tests__/testing.ts";
import { connectTrpcTransport } from "../connect.trpc.ts";
import type { LicensingTrpcTestContext } from "./licensing.trpc.harness.ts";

async function mount(options: { permits?: (permission: string) => boolean } = {}) {
  const licensing = await createTestLicensingApp();
  const trpc = initTRPC.context<LicensingTrpcTestContext>().create();
  const router = createTrpcRuntime<LicensingTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<LicensingTrpcTestContext>({ permits: options.permits }),
  }).mount(connectTrpcTransport, () => licensing);

  return { router, caller: router.createCaller({ actor: { id: "user-123" } }) };
}

describe("the connect tRPC namespace", () => {
  it("exposes exactly the procedure names the settings page calls", async () => {
    const { router } = await mount();

    expect(Object.keys(router._def.procedures).toSorted()).toEqual([
      "setCap",
      "setService",
      "status",
    ]);
  });

  /** @scenario "A member who is not an admin cannot switch a service on" */
  it("lets any member read the status but refuses both writes", async () => {
    const { caller } = await mount({ permits: (permission) => permission === "organization:view" });

    await expect(caller.status({ organizationId: "org-acme" })).resolves.toBeDefined();
    await expect(
      caller.setService({ organizationId: "org-acme", service: "instant_evals", enabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.setCap({ organizationId: "org-acme", capUsd: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

async function setServiceAudited({ enabled }: { enabled: boolean }) {
  const record = vi.fn();
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz: createApiFixture<Authorize>({
      getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
    audit: { record },
  });
  const app = createApiFixture<LicensingApi>({
    setConnectService: async () => ({ enabledServices: enabled ? ["instant_evals"] : [] }),
  });
  trpc.mount(composeTrpcRouters("connect", [connectTrpcTransport]), () => app);
  const request = new Request(`http://api.test${TrpcHost.path}/connect.setService`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org-acme", service: "instant_evals", enabled }),
  });

  const response = await fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
  });
  return { response, entry: record.mock.calls[0]?.[0], recorded: record.mock.calls.length };
}

describe("a change an admin makes on the Connect page", () => {
  /** @scenario Switching a service on leaves an audit record */
  it("records a switch on with who made it, on which organization, and what changed", async () => {
    const { response, entry, recorded } = await setServiceAudited({ enabled: true });

    expect(response.status).toBe(200);
    expect(recorded).toBe(1);
    expect(entry).toMatchObject({
      userId: "sam",
      organizationId: "org-acme",
      action: "connect.setService",
      args: { service: "instant_evals", enabled: true },
    });
  });

  /** @scenario Switching a service off is an admin decision that is recorded */
  it("records a switch off with who made it, on which organization, and what changed", async () => {
    const { response, entry, recorded } = await setServiceAudited({ enabled: false });

    expect(response.status).toBe(200);
    expect(recorded).toBe(1);
    expect(entry).toMatchObject({
      userId: "sam",
      organizationId: "org-acme",
      action: "connect.setService",
      args: { service: "instant_evals", enabled: false },
    });
  });
});
