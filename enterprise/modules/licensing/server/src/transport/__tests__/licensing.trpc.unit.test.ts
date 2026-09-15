/**
 * @vitest-environment node
 * The `license.*` procedures over the real runtime and a real `LicensingApp`.
 * @see specs/licensing/license-router.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createTestLicensingApp, EXPIRED_LICENSE_KEY } from "../../testing.ts";
import { licenseTrpcTransport } from "../licensing.trpc.ts";
import { licensingTrpcTestPorts, type LicensingTrpcTestContext } from "./licensing.trpc.harness.ts";

function mount(options: { permits?: (permission: string) => boolean } = {}) {
  const licensing = createTestLicensingApp();
  const trpc = initTRPC.context<LicensingTrpcTestContext>().create();
  const router = createTrpcRuntime<LicensingTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: licensingTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(licenseTrpcTransport, () => licensing);

  return { router, caller: router.createCaller({ actor: { id: "user-123" } }) };
}

describe("the license tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "generate",
        "getSsoGateStatus",
        "getStatus",
        "remove",
        "upload",
      ]);
    });

    it("reads with a query and changes with a mutation", () => {
      const { router } = mount();
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        getStatus: "query",
        getSsoGateStatus: "query",
        upload: "mutation",
        remove: "mutation",
        generate: "mutation",
      });
    });
  });

  describe("given a caller who may read the organization but not manage it", () => {
    describe("when a write is called", () => {
      it("refuses the write and still answers the read", async () => {
        const { caller } = mount({ permits: (permission) => permission === "organization:view" });

        await expect(caller.getStatus({ organizationId: "org-456" })).resolves.toEqual({
          hasLicense: false,
          valid: false,
        });
        await expect(caller.remove({ organizationId: "org-456" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });
  });

  describe("given an organization with no license", () => {
    describe("when license.getStatus is called", () => {
      /** @scenario "Gets license status for organization without license" */
      it("answers hasLicense and valid both false", async () => {
        const { caller } = mount();

        const status = await caller.getStatus({ organizationId: "org-456" });

        expect(status).toEqual({ hasLicense: false, valid: false });
      });
    });
  });

  describe("given a license key past its expiry date", () => {
    describe("when license.upload is called with it", () => {
      /** @scenario "Returns error for expired license" */
      it("refuses with the expired-license code at 400", async () => {
        const { caller } = mount();

        await expect(
          caller.upload({ organizationId: "org-456", licenseKey: EXPIRED_LICENSE_KEY }),
        ).rejects.toMatchObject({ cause: { code: "license_expired", httpStatus: 400 } });
      });
    });
  });

  describe("given a term that has already elapsed", () => {
    describe("when license.generate is called with it", () => {
      it("refuses on the field the operator typed it in", async () => {
        const { caller } = mount();

        await expect(
          caller.generate({
            organizationId: "org-456",
            privateKey: "-----BEGIN PRIVATE KEY-----",
            organizationName: "Acme Corp",
            email: "admin@acme.corp",
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
            planType: "PRO",
            plan: {
              maxMembers: 5,
              maxMembersLite: 5,
              maxMessagesPerMonth: 50_000,
              canPublish: true,
              usageUnit: "traces",
            },
          }),
        ).rejects.toMatchObject({
          cause: { code: "validation_error", meta: { fieldErrors: { expiresAt: expect.any(Array) } } },
        });
      });
    });
  });
});
