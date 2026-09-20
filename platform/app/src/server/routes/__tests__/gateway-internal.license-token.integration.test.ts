/**
 * @vitest-environment node
 *
 * A license token on the gateway's key resolution route, against real Postgres:
 * it resolves to a managed key on the customer organization, a virtual key is
 * resolved exactly as before, and revoking the license writes the change that
 * evicts a gateway's cached credential.
 *
 * Spec: specs/self-hosting/connected-services/license-credential.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { eligibleModelProvidersForVk } from "~/server/gateway/scopeResolver";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { licenseTokenHarness } from "./support/licenseTokenHarness";

describe("a license token on resolve-key (real PG + internal route)", () => {
  const harness = licenseTokenHarness();
  const { claimsOf, issue, resolve } = harness;
  const USER_ID = harness.userId;
  const suffix = harness.suffix;
  const NEXT_YEAR = harness.nextYear;
  const organizationIds = harness.organizationIds;
  const registry = harness.registry;

  beforeAll(async () => {
    await startTestContainers();
    await harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
    await stopTestContainers();
  });

  describe("given an active license registered to a customer with no team or project", () => {
    describe("when the install's token is resolved with its instance id", () => {
      /** @scenario A registered license resolves to the customer's managed key */
      /** @scenario Forwarded calls are metered under the customer organization */
      it("is accepted and attributed to the customer organization", async () => {
        const license = await issue();

        const { status, json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        expect(status).toBe(200);
        expect(claimsOf(json.jwt as string)).toMatchObject({
          org_id: license.organizationId,
          vk_id: json.key_id,
        });
        const key = await prisma.virtualKey.findUnique({
          where: { id: json.key_id as string },
        });
        expect(key).toMatchObject({
          organizationId: license.organizationId,
          purpose: "CONNECT",
          status: "ACTIVE",
        });
        expect(key?.traceProjectId).toBeTruthy();
      });

      it("ends the signed token with the license term at the latest", async () => {
        const license = await issue();

        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        const { exp } = claimsOf(json.jwt as string) as { exp: number };
        expect(exp * 1000).toBeLessThanOrEqual(NEXT_YEAR.getTime());
      });
    });

    describe("when a customer admin looks for the managed key", () => {
      /** @scenario The managed key is not visible or editable as a customer key */
      it("is absent from the list and refuses a customer revoke", async () => {
        const license = await issue();
        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        const service = VirtualKeyService.create(prisma);

        expect(await service.getAll(license.organizationId)).toEqual([]);
        expect(
          await service.getById(json.key_id as string, license.organizationId),
        ).toBeNull();
        await expect(
          service.revoke({
            id: json.key_id as string,
            organizationId: license.organizationId,
            actorUserId: USER_ID,
          }),
        ).rejects.toThrow();
      });

      /** @scenario A license token reaches none of the customer's own model providers */
      it("reaches none of the customer organization's own model providers", async () => {
        const license = await issue();
        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        const provider = await prisma.modelProvider.create({
          data: {
            organizationId: license.organizationId,
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            scopes: {
              create: {
                scopeType: "ORGANIZATION",
                scopeId: license.organizationId,
              },
            },
          },
        });
        const service = VirtualKeyService.create(prisma);
        const managed = await service.getManagedByIdInternal(
          json.key_id as string,
          license.organizationId,
        );
        if (!managed) throw new Error("expected the managed key");
        // The same scope on a customer key does reach the provider, so an
        // empty answer for the managed key is the rule and not a missing row.
        const { virtualKey: customerKey } = await service.create({
          organizationId: license.organizationId,
          name: `customer-${nanoid(6)}`,
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: license.organizationId },
          ],
          traceProjectId: managed.traceProjectId,
          actorUserId: USER_ID,
        });

        expect(
          (await eligibleModelProvidersForVk(prisma, customerKey)).map(
            (mp) => mp.id,
          ),
        ).toEqual([provider.id]);
        expect(await eligibleModelProvidersForVk(prisma, managed)).toEqual([]);
      });
    });

    describe("when the license is revoked after a gateway resolved it", () => {
      /** @scenario Revoking a license revokes its managed key */
      it("ends the key, writes the change gateways evict on, and refuses the token", async () => {
        const license = await issue();
        const first = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        await registry.revoke({
          id: license.id,
          operatorId: USER_ID,
          reason: "leaked",
        });

        expect(
          await prisma.gatewayChangeEvent.findFirst({
            where: {
              organizationId: license.organizationId,
              kind: "VK_REVOKED",
              virtualKeyId: first.json.key_id as string,
            },
          }),
        ).not.toBeNull();
        const after = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        expect(after.status).toBe(403);
        expect(after.json.error?.code).toBe("connect_license_revoked");
      });
    });

    describe("when calls present an unregistered token, a revoked one and one bound elsewhere", () => {
      /** @scenario Refusals do not reveal license metadata */
      it("answers with a code and nothing about the customer, the seats or the term", async () => {
        const revoked = await issue(73);
        await registry.revoke({
          id: revoked.id,
          operatorId: USER_ID,
          reason: "leaked",
        });
        const bound = await issue(73);
        await resolve({
          key_presented: bound.token,
          instance_id: "instance-a",
        });

        const refusals = await Promise.all([
          resolve({
            key_presented: `lwl_${"0".repeat(64)}`,
            instance_id: "instance-a",
          }),
          resolve({ key_presented: revoked.token, instance_id: "instance-a" }),
          resolve({ key_presented: bound.token, instance_id: "instance-b" }),
          resolve({ key_presented: bound.token }),
        ]);

        expect(refusals.map((r) => [r.status, r.json.error?.code])).toEqual([
          [401, "connect_license_not_registered"],
          [403, "connect_license_revoked"],
          [403, "connect_wrong_instance"],
          [400, "connect_instance_required"],
        ]);
        for (const { text } of refusals) {
          expect(text).not.toContain("ACME");
          expect(text).not.toContain("73");
          expect(text).not.toContain(String(NEXT_YEAR.getFullYear()));
        }
      });
    });
  });

  describe("given a Cloud project with a virtual key", () => {
    /** @scenario A virtual key keeps working next to the license token */
    it("resolves the virtual key exactly as before", async () => {
      const organization = await prisma.organization.create({
        data: { name: `VK Org ${suffix}`, slug: `lwl-vk-${suffix}` },
      });
      organizationIds.push(organization.id);
      const team = await prisma.team.create({
        data: {
          name: "Team",
          slug: `lwl-vk-team-${suffix}`,
          organizationId: organization.id,
        },
      });
      const project = await prisma.project.create({
        data: {
          name: "Project",
          slug: `lwl-vk-proj-${suffix}`,
          teamId: team.id,
          language: "en",
          framework: "openai",
          apiKey: `lwl-vk-key-${suffix}`,
        },
      });
      const { secret, virtualKey } = await VirtualKeyService.create(
        prisma,
      ).create({
        organizationId: organization.id,
        name: `key-${suffix}`,
        scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
        actorUserId: USER_ID,
      });

      const { status, json } = await resolve({ key_presented: secret });

      expect(status).toBe(200);
      expect(json.key_id).toBe(virtualKey.id);
      expect(claimsOf(json.jwt as string)).toMatchObject({
        org_id: organization.id,
        project_id: project.id,
      });
    });
  });
});
