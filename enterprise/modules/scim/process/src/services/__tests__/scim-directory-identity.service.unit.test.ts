// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Who the directory means (D08).
 *
 * A tiny in-memory store standing in for the `ScimExternalId` table, so what
 * is asserted is the RULE — the pair is the key, and `externalId` alone never
 * resolves anything — rather than Prisma's argument shapes. The composite
 * uniqueness itself is the database's, declared on the model.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { HeldConnectionsFake } from "../../__tests__/support/held-connections-fake.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { ScimDirectoryIdentityService } from "../scim-directory-identity.service.ts";

const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";
const ACME = "org_acme";

describe("ScimDirectoryIdentityService", () => {
  let store: MemoryScimRepository;
  let service: ScimDirectoryIdentityService;

  beforeEach(() => {
    store = MemoryScimRepository.create();
    service = ScimDirectoryIdentityService.create({
      repository: store,
      connections: HeldConnectionsFake.of([OKTA, ENTRA]),
    });
  });

  describe("when a person's address changes", () => {
    /** @scenario A person keeps their place when their address changes */
    it("resolves them to the same account, because the identifier is the key", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });

      // The second push carries a new address and the same identifier; only
      // the identifier is looked up, so the address never enters into it.
      const resolved = await service.findUserId({
        connectionId: OKTA,
        externalId: "u-1",
      });

      expect(resolved).toBe("user_sam");
      expect(store.directoryIdentities).toHaveLength(1);
    });
  });

  describe("when the same person is pushed by two connections", () => {
    /** @scenario The same person on two connections is two directory identities, one account */
    it("keeps both identities, neither overwriting the other", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_sam",
      });

      await expect(service.findUserId({ connectionId: OKTA, externalId: "u-1" })).resolves.toBe(
        "user_sam",
      );
      await expect(service.findUserId({ connectionId: ENTRA, externalId: "c-99" })).resolves.toBe(
        "user_sam",
      );
      expect(store.directoryIdentities).toHaveLength(2);
    });
  });

  describe("when two connections push the same identifier", () => {
    /** @scenario The same directory identifier on two connections is two different people */
    it("resolves each within its own connection and never to the other's person", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "u-1",
        userId: "user_kim",
      });

      await expect(service.findUserId({ connectionId: OKTA, externalId: "u-1" })).resolves.toBe(
        "user_sam",
      );
      await expect(service.findUserId({ connectionId: ENTRA, externalId: "u-1" })).resolves.toBe(
        "user_kim",
      );
    });
  });

  describe("when a connection pushes an identifier nobody knows", () => {
    /** @scenario A push naming a person no connection knows provisions within that connection only */
    it("records them under that connection alone", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-new",
        userId: "user_new",
      });

      await expect(
        service.findUserId({ connectionId: ENTRA, externalId: "u-new" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a push aims at somebody another connection provisioned", () => {
    it("refuses with scim_write_outside_connection", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      await expect(
        service.assertWritable({ organizationId: ACME, connectionId: OKTA, userId: "user_kim" }),
      ).rejects.toMatchObject({
        code: "scim_write_outside_connection",
        httpStatus: 403,
      });
    });

    it("names only the person the caller already sent", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      const refusal = await service
        .assertWritable({ organizationId: ACME, connectionId: OKTA, userId: "user_kim" })
        .catch((error: unknown) => error);

      expect((refusal as { meta: Record<string, unknown> }).meta).toEqual({
        userId: "user_kim",
      });
    });
  });

  describe("when a push aims at somebody its own connection provisioned", () => {
    it("allows it", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });

      await expect(
        service.assertWritable({ organizationId: ACME, connectionId: OKTA, userId: "user_sam" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a push aims at somebody no connection has claimed", () => {
    it("allows it, so a directory can adopt a hand-invited member", async () => {
      await expect(
        service.assertWritable({
          organizationId: ACME,
          connectionId: OKTA,
          userId: "user_invited",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a token that predates connection scoping", () => {
    /** @scenario "Tokens issued before connections existed keep exactly the reach they had" */
    it("checks nothing, keeping the organization-wide authority it was sold with", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      await expect(
        service.assertWritable({ organizationId: ACME, connectionId: null, userId: "user_kim" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a person leaves a directory", () => {
    /** @scenario Deleting a directory person forgets ownership without reclaiming it */
    it("forgets that connection's identity and no other's", async () => {
      await service.remember({
        organizationId: ACME,
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        organizationId: ACME,
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_sam",
      });

      await service.forgetUser({ organizationId: ACME, connectionId: OKTA, userId: "user_sam" });

      await expect(
        service.findUserId({ connectionId: OKTA, externalId: "u-1" }),
      ).resolves.toBeNull();
      await expect(service.findUserId({ connectionId: ENTRA, externalId: "c-99" })).resolves.toBe(
        "user_sam",
      );
      await expect(
        service.assertWritable({ organizationId: ACME, connectionId: OKTA, userId: "user_sam" }),
      ).rejects.toMatchObject({ code: "scim_write_outside_connection" });
    });
  });
});
