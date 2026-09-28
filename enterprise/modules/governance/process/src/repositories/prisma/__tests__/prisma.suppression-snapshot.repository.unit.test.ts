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
  governanceOperatorReads,
  PrismaSuppressionSnapshotRepository,
} from "../prisma.suppression-snapshot.repository.ts";

const SUPPRESSION = { organizationId: "org_a", provider: "anthropic_admin", identifierHash: "h1" };
const TENANT = { organizationId: "org_b", tenantId: "tenant_b" };

function snapshotOver({ declared }: { declared: readonly OperatorReadHandle[] }) {
  const suppressions = vi.fn().mockResolvedValue([SUPPRESSION]);
  const tenants = vi.fn().mockResolvedValue([TENANT]);
  const mint = vi.fn<OperatorReadMint>(() =>
    prismaDouble({
      erasedIdentifierSuppression: { findMany: suppressions },
      governanceTenantHistory: { findMany: tenants },
    }),
  );
  const operatorReads = OperatorReadsResolver.over({ mint }).scopeTo({
    owner: "governance",
    declared,
  });
  return { operatorReads, mint, suppressions, tenants };
}

describe("given governance's declared operator reads", () => {
  describe("when the suppression snapshot loads", () => {
    /** @scenario "Governance reads the erasure snapshot across organizations through its declared handles" */
    it("reads every organization's digests and tenants through its own two handles", async () => {
      const { operatorReads, mint, suppressions, tenants } = snapshotOver({
        declared: Object.values(governanceOperatorReads),
      });
      const snapshot = PrismaSuppressionSnapshotRepository.create({ operatorReads });

      await expect(snapshot.findAllSuppressions()).resolves.toEqual([SUPPRESSION]);
      await expect(snapshot.findAllTenants()).resolves.toEqual([TENANT]);
      expect(mint.mock.calls.map(([input]) => input)).toEqual([
        { owner: "governance", handle: governanceOperatorReads.suppressions },
        { owner: "governance", handle: governanceOperatorReads.tenantHistory },
      ]);
      expect(suppressions).toHaveBeenCalledWith({ select: expect.any(Object) });
      expect(tenants).toHaveBeenCalledWith({ select: expect.any(Object) });
    });
  });

  describe("when governance's scope does not carry the handles", () => {
    /** @scenario "Governance's erasure snapshot is refused where its operator reads were not declared" */
    it("refuses to build the snapshot and mints no client", () => {
      const { operatorReads, mint } = snapshotOver({ declared: [] });

      expect(() => PrismaSuppressionSnapshotRepository.create({ operatorReads })).toThrow(
        UndeclaredOperatorReadError,
      );
      expect(mint).not.toHaveBeenCalled();
    });
  });
});
