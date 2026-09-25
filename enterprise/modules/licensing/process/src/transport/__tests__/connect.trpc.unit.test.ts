/**
 * @vitest-environment node
 * The `connect.*` procedures over the real runtime and a real `LicensingApp`.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createTestLicensingApp } from "../../testing.ts";
import { connectTrpcTransport } from "../connect.trpc.ts";
import {
  licensingTrpcTestMembers,
  type LicensingTrpcTestContext,
} from "./licensing.trpc.harness.ts";

async function mount(options: { permits?: (permission: string) => boolean } = {}) {
  const licensing = await createTestLicensingApp();
  const trpc = initTRPC.context<LicensingTrpcTestContext>().create();
  const router = createTrpcRuntime<LicensingTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: licensingTrpcTestMembers(options.permits ?? (() => true)),
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
    ).rejects.toBeDefined();
    await expect(caller.setCap({ organizationId: "org-acme", capUsd: 10 })).rejects.toBeDefined();
  });
});
