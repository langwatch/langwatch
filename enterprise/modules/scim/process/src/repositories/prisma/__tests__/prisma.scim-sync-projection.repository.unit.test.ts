// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type OperatorReadHandle,
  type OperatorReadMint,
  OperatorReadsResolver,
  UndeclaredOperatorReadError,
} from "@langwatch/prisma-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import {
  PrismaScimSyncProjectionRepository,
  scimOperatorReads,
} from "../prisma.scim-sync-projection.repository.ts";

const ROW = {
  id: "ssoc_acme",
  connectionId: "ssoc_acme",
  organizationId: "org_acme",
  state: "SYNCING",
  lastPushedAt: new Date(1_700_000_000_000),
  lastFailure: null,
  deadLetters: [],
  revokedCause: null,
  createdAt: new Date(1_600_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
};

function repositoryOver({ declared }: { declared: readonly OperatorReadHandle[] }) {
  const findMany = vi.fn().mockResolvedValue([ROW]);
  const count = vi.fn().mockResolvedValue(1);
  const guardedFindMany = vi.fn().mockResolvedValue([]);
  const mint = vi.fn<OperatorReadMint>(() => prismaDouble({ scimSyncState: { findMany, count } }));
  const operatorReads = OperatorReadsResolver.over({ mint }).scopeTo({ owner: "scim", declared });
  const prisma = prismaDouble({ scimSyncState: { findMany: guardedFindMany } });
  return { operatorReads, prisma, mint, findMany, count, guardedFindMany };
}

describe("given scim's declared operator read of ScimSyncState", () => {
  describe("when the operator lists directory syncs", () => {
    /** @scenario "Scim lists every organization's directory syncs through its declared handle" */
    it("pages and counts across organizations on the declared handle, not the guarded client", async () => {
      const { operatorReads, prisma, mint, findMany, count, guardedFindMany } = repositoryOver({
        declared: Object.values(scimOperatorReads),
      });
      const syncs = PrismaScimSyncProjectionRepository.create({ prisma, operatorReads });

      const page = await syncs.listPageForOperator({ page: 1, pageSize: 25 });

      expect(page.total).toBe(1);
      expect(page.syncs.map((sync) => sync.organizationId)).toEqual(["org_acme"]);
      expect(mint.mock.calls.map(([input]) => input)).toEqual([
        { owner: "scim", handle: scimOperatorReads.syncs },
      ]);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25 }));
      expect(count).toHaveBeenCalledWith({ where: {} });
      expect(guardedFindMany).not.toHaveBeenCalled();
    });

    it("finds one connection's sync whichever organization holds it", async () => {
      const { operatorReads, prisma, findMany } = repositoryOver({
        declared: Object.values(scimOperatorReads),
      });
      const syncs = PrismaScimSyncProjectionRepository.create({ prisma, operatorReads });

      await expect(
        syncs.findByConnectionForOperator({ connectionId: "ssoc_acme" }),
      ).resolves.toHaveLength(1);
      expect(findMany).toHaveBeenCalledWith({ where: { id: "ssoc_acme" } });
    });
  });

  describe("when scim's scope does not carry the handle", () => {
    /** @scenario "Scim's directory-sync list is refused where its operator read was not declared" */
    it("refuses to build the repository and mints no client", () => {
      const { operatorReads, prisma, mint } = repositoryOver({ declared: [] });

      expect(() => PrismaScimSyncProjectionRepository.create({ prisma, operatorReads })).toThrow(
        UndeclaredOperatorReadError,
      );
      expect(mint).not.toHaveBeenCalled();
    });
  });
});
