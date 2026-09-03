/**
 * Which code issues the gateway composition's `VirtualKey` reads.
 *
 * The spend surfaces read key ids out of the ClickHouse ledger and need a
 * label per id. The API's gateway composition used to answer that with a
 * `prisma.virtualKey.findMany` written in the composition itself — the same
 * class of seam as the credential read next door, one table over: `VirtualKey`
 * carries every key's hashed secret, the previous secret it rotated away from,
 * and the window that older secret stays valid in.
 *
 * The composition holds the client the gateway's own repository runs on, so a
 * client that refused every access would refuse the feature too. What this
 * pins instead is that exactly one kind of statement reaches the delegate, and
 * that it is the REPOSITORY's: `findMetaByIds`, three columns, fenced by the
 * owning organization. Every other property on the delegate throws, so a read
 * written back into the composition under any other method name fails here,
 * and a `findMany` written back under the composition's old selection fails the
 * argument assertion.
 */
// @vitest-environment node
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { composeApiGateway } from "../api-gateway.composition";

const ORGANIZATION_ID = "organization-1";

/**
 * The one virtual-key statement this composition is allowed to reach, and a
 * trap for every other.
 */
function gatewayPrisma() {
  const rows = [
    { id: "vk_1", name: "Customer A key", displayPrefix: "vk-lw-01HZX9N" },
    { id: "vk_2", name: "Nightly batch", displayPrefix: "vk-lw-01HZX9P" },
  ];
  // `select` is honoured, so a read written back into the composition with its
  // own two-column selection still returns exactly what the caller wanted and
  // the only thing that gives it away is the query itself.
  const findMany = vi.fn(async ({ select }: { select?: Record<string, boolean> }) =>
    rows.map((row) =>
      select
        ? Object.fromEntries(
            Object.keys(select).map((column) => [column, row[column as keyof typeof row]]),
          )
        : { ...row },
    ),
  );

  const virtualKey = new Proxy(
    { findMany },
    {
      get(target, property) {
        if (property === "findMany") return target.findMany;
        throw new Error(
          `the gateway composition reached prisma.virtualKey.${String(property)}; key rows are the gateway feature's read`,
        );
      },
    },
  );

  return { prisma: { virtualKey } as unknown as PrismaClient, findMany };
}

function composeGateway() {
  const { prisma, findMany } = gatewayPrisma();
  const composition = composeApiGateway({
    prisma,
    authz: { hasPermission: async () => true } as unknown as AuthzService,
    projects: {} as unknown as ProjectService,
    evaluators: {} as unknown as EvaluatorService,
    monitors: {} as unknown as MonitorService,
    clickhouse: null,
    virtualKeyPepper: "test-virtual-key-pepper",
  });
  return { composition, findMany };
}

describe("given an API process that composed the gateway application", () => {
  describe("when a page of spend rows needs a label per key", () => {
    /** @scenario "Virtual key rows are read only through the gateway feature" */
    it("resolves the names through the gateway's own repository, fenced by the organization", async () => {
      const { composition, findMany } = composeGateway();

      const names = await composition.app.resolveVirtualKeyNames({
        organizationId: ORGANIZATION_ID,
        virtualKeyIds: ["vk_1", "vk_2"],
      });

      expect(names).toEqual([
        { id: "vk_1", name: "Customer A key" },
        { id: "vk_2", name: "Nightly batch" },
      ]);
      expect(findMany).toHaveBeenCalledWith({
        where: { organizationId: ORGANIZATION_ID, id: { in: ["vk_1", "vk_2"] } },
        select: { id: true, name: true, displayPrefix: true },
      });
    });

    it("asks the table nothing when the page named no keys", async () => {
      const { composition, findMany } = composeGateway();

      await expect(
        composition.app.resolveVirtualKeyNames({
          organizationId: ORGANIZATION_ID,
          virtualKeyIds: [],
        }),
      ).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
