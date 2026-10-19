/**
 * The connect upstream's Postgres row: the license token rests sealed in `encryptedToken`
 * and reads back opened.
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaGatewayConnectUpstreamRepository } from "../prisma.gateway-connect-upstream.repository.ts";

const cipher = {
  encrypt: (plaintext: string) => `sealed(${plaintext})`,
  decrypt: (ciphertext: string) => ciphertext.replace(/^sealed\((.*)\)$/, "$1"),
};

type Row = { organizationId: string; baseUrl: string; encryptedToken: string; instanceId: string };

function tableOfOneRow() {
  const rows = new Map<string, Row>();
  const database = prismaDouble({
    gatewayConnectUpstream: {
      // One organization per test, so a read answers every row.
      findMany: () => Promise.resolve([...rows.values()]),
      upsert: (args: { create: Row }) => {
        rows.set(args.create.organizationId, args.create);
        return Promise.resolve(args.create);
      },
    },
  });
  return {
    rows,
    repository: PrismaGatewayConnectUpstreamRepository.create({ prisma: database, cipher }),
  };
}

const slot = {
  organizationId: "org-1",
  baseUrl: "https://gateway.langwatch.ai/",
  token: `lwl_${"a1".repeat(32)}`,
  instanceId: "instance-1",
};

describe("PrismaGatewayConnectUpstreamRepository", () => {
  describe("when licensing saves an organization's slot", () => {
    it("keeps the license token encrypted at rest and reads it back whole", async () => {
      const { rows, repository } = tableOfOneRow();

      await repository.save(slot);

      expect(rows.get("org-1")?.encryptedToken).toBe(cipher.encrypt(slot.token));
      expect(await repository.findForOrganization("org-1")).toEqual([slot]);
    });
  });
});
