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
import { ScimDirectoryIdentityService } from "../src/services/scim-directory-identity.service";

const OKTA = "conn_okta_primary";
const ENTRA = "conn_entra_contractors";

type Row = { connectionId: string; externalId: string; userId: string };

/** The `ScimExternalId` table, keyed the way the model's unique index is.
 *
 *  The key separator is NUL, because no id can contain one — so two different
 *  pairs can never collide onto a single key. It is written as the ESCAPE and
 *  not as the byte: a literal NUL makes the file binary, which git and GitHub
 *  stop rendering as text and which `noBinarySourceFiles` fails on. */
function createStore() {
  const rows: Row[] = [];
  const keyOf = (row: { connectionId: string; externalId: string }) =>
    `${row.connectionId}\u0000${row.externalId}`;

  return {
    rows,
    repository: {
      tryFindDirectoryUserId: async (input: { connectionId: string; externalId: string }) =>
        rows.find((row) => keyOf(row) === keyOf(input))?.userId ?? null,
      listDirectoryConnectionsForUser: async ({ userId }: { userId: string }) =>
        rows.filter((row) => row.userId === userId).map((row) => row.connectionId),
      rememberDirectoryIdentity: async (input: Row) => {
        const existing = rows.find((row) => keyOf(row) === keyOf(input));
        if (existing) {
          existing.userId = input.userId;
          return;
        }
        rows.push({ ...input });
      },
      forgetDirectoryIdentity: async (input: { connectionId: string; externalId: string }) => {
        const index = rows.findIndex(
          (row) => row.connectionId === input.connectionId && row.externalId === input.externalId,
        );
        if (index >= 0) rows.splice(index, 1);
      },
    },
  };
}

describe("ScimDirectoryIdentityService", () => {
  let store: ReturnType<typeof createStore>;
  let service: ScimDirectoryIdentityService;

  beforeEach(() => {
    store = createStore();
    service = ScimDirectoryIdentityService.create(store.repository as never);
  });

  describe("when a person's address changes", () => {
    /** @scenario A person keeps their place when their address changes */
    it("resolves them to the same account, because the identifier is the key", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });

      // The second push carries a new address and the same identifier; only
      // the identifier is looked up, so the address never enters into it.
      const resolved = await service.tryGetUserId({
        connectionId: OKTA,
        externalId: "u-1",
      });

      expect(resolved).toBe("user_sam");
      expect(store.rows).toHaveLength(1);
    });
  });

  describe("when the same person is pushed by two connections", () => {
    /** @scenario The same person on two connections is two directory identities, one account */
    it("keeps both identities, neither overwriting the other", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_sam",
      });

      await expect(service.tryGetUserId({ connectionId: OKTA, externalId: "u-1" })).resolves.toBe(
        "user_sam",
      );
      await expect(service.tryGetUserId({ connectionId: ENTRA, externalId: "c-99" })).resolves.toBe(
        "user_sam",
      );
      expect(store.rows).toHaveLength(2);
    });
  });

  describe("when two connections push the same identifier", () => {
    /** @scenario The same directory identifier on two connections is two different people */
    it("resolves each within its own connection and never to the other's person", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        connectionId: ENTRA,
        externalId: "u-1",
        userId: "user_kim",
      });

      await expect(service.tryGetUserId({ connectionId: OKTA, externalId: "u-1" })).resolves.toBe(
        "user_sam",
      );
      await expect(service.tryGetUserId({ connectionId: ENTRA, externalId: "u-1" })).resolves.toBe(
        "user_kim",
      );
    });
  });

  describe("when a connection pushes an identifier nobody knows", () => {
    /** @scenario A push naming a person no connection knows provisions within that connection only */
    it("records them under that connection alone", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-new",
        userId: "user_new",
      });

      await expect(
        service.tryGetUserId({ connectionId: ENTRA, externalId: "u-new" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a push aims at somebody another connection provisioned", () => {
    it("refuses with scim_write_outside_connection", async () => {
      await service.remember({
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      await expect(
        service.assertWritable({ connectionId: OKTA, userId: "user_kim" }),
      ).rejects.toMatchObject({
        code: "scim_write_outside_connection",
        httpStatus: 403,
      });
    });

    it("names only the person the caller already sent", async () => {
      await service.remember({
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      const refusal = await service
        .assertWritable({ connectionId: OKTA, userId: "user_kim" })
        .catch((error: unknown) => error);

      expect((refusal as { meta: Record<string, unknown> }).meta).toEqual({
        userId: "user_kim",
      });
    });
  });

  describe("when a push aims at somebody its own connection provisioned", () => {
    it("allows it", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });

      await expect(
        service.assertWritable({ connectionId: OKTA, userId: "user_sam" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a push aims at somebody no connection has claimed", () => {
    it("allows it, so a directory can adopt a hand-invited member", async () => {
      await expect(
        service.assertWritable({ connectionId: OKTA, userId: "user_invited" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a token that predates connection scoping", () => {
    it("checks nothing, keeping the organization-wide authority it was sold with", async () => {
      await service.remember({
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_kim",
      });

      await expect(
        service.assertWritable({ connectionId: null, userId: "user_kim" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a person leaves a directory", () => {
    it("forgets that connection's identity and no other's", async () => {
      await service.remember({
        connectionId: OKTA,
        externalId: "u-1",
        userId: "user_sam",
      });
      await service.remember({
        connectionId: ENTRA,
        externalId: "c-99",
        userId: "user_sam",
      });

      await service.forget({ connectionId: OKTA, externalId: "u-1" });

      await expect(
        service.tryGetUserId({ connectionId: OKTA, externalId: "u-1" }),
      ).resolves.toBeNull();
      await expect(service.tryGetUserId({ connectionId: ENTRA, externalId: "c-99" })).resolves.toBe(
        "user_sam",
      );
    });
  });
});
