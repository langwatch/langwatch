/**
 * The Postgres side of the A2A target registry: headers rest sealed and unseal only when asked,
 * the allow-list columns map to null versus a list, a guarded move matches the upstream it
 * checked, and a live-name index violation is a coded refusal.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaGatewayA2aTargetRepository } from "../prisma.gateway-a2a-target.repository.ts";

const input = {
  organizationId: "org_1",
  projectId: null,
  name: "billing",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  actorUserId: "user_1",
};

const at = new Date("2026-11-20T00:00:00.000Z");

const storedRow = {
  id: "gateway_01",
  organizationId: "org_1",
  projectId: "p1",
  name: "billing",
  agentName: "Billing agent",
  cardUrl: input.cardUrl,
  upstreamUrl: input.upstreamUrl,
  encryptedUpstreamHeaders: null as string | null,
  restrictToAllowList: false,
  allowedVirtualKeyIds: [] as string[],
  blocked: false,
  blockReason: null,
  createdById: "user_1",
  createdAt: at,
  updatedAt: at,
  archivedAt: null as Date | null,
};

type Row = typeof storedRow;

/** A reversible stand-in cipher that counts how often anything is unsealed. */
function countingCipher() {
  const unsealed: string[] = [];
  return {
    unsealed,
    cipher: {
      encrypt: (text: string) => `sealed:${Buffer.from(text).toString("base64")}`,
      decrypt: (text: string) => {
        unsealed.push(text);
        return Buffer.from(text.replace(/^sealed:/, ""), "base64").toString();
      },
    },
  };
}

const sealedHeaders = countingCipher().cipher.encrypt(JSON.stringify({ "X-Token": "s3cret" }));

function recordingDatabase({
  rows = [storedRow],
  updateFailure,
}: { rows?: Row[]; updateFailure?: unknown } = {}) {
  const calls: Record<"findMany" | "create" | "update", unknown[]> = {
    findMany: [],
    create: [],
    update: [],
  };
  /** The stored row with the columns a write set; an undefined column is left as it was. */
  const merged = (args: unknown): Row => ({
    ...storedRow,
    ...Object.fromEntries(
      Object.entries((args as { data: Partial<Row> }).data).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  });
  const prisma = prismaDouble({
    gatewayA2ATarget: {
      findMany: (args: unknown) => {
        calls.findMany.push(args);
        return Promise.resolve(rows);
      },
      create: (args: unknown) => {
        calls.create.push(args);
        return Promise.resolve(merged(args));
      },
      update: (args: unknown) => {
        calls.update.push(args);
        return updateFailure ? Promise.reject(updateFailure) : Promise.resolve(merged(args));
      },
    },
  });
  const { cipher, unsealed } = countingCipher();
  return {
    calls,
    unsealed,
    repository: PrismaGatewayA2aTargetRepository.create({ prisma, cipher }),
  };
}

function repositoryRejectingCreate(error: unknown) {
  const prisma = prismaDouble({
    gatewayA2ATarget: { create: () => Promise.reject(error) },
  });
  return PrismaGatewayA2aTargetRepository.create({ prisma, cipher: countingCipher().cipher });
}

describe("PrismaGatewayA2aTargetRepository", () => {
  describe("when a target is created with upstream headers", () => {
    it("stores them sealed and answers them unsealed", async () => {
      const { repository, calls } = recordingDatabase();

      const created = await repository.create({
        ...input,
        upstreamHeaders: { "X-Token": "s3cret" },
      });

      const [args] = calls.create as { data: Row }[];
      expect(args?.data.encryptedUpstreamHeaders).toBe(sealedHeaders);
      expect(JSON.stringify(args)).not.toContain("s3cret");
      expect(created.upstreamHeaders).toEqual({ "X-Token": "s3cret" });
    });
  });

  describe("when a target is created without upstream headers", () => {
    it("stores no sealed value at all", async () => {
      const { repository, calls } = recordingDatabase();

      await repository.create(input);

      expect((calls.create as { data: Row }[])[0]?.data.encryptedUpstreamHeaders).toBeNull();
    });
  });

  describe("given a target with sealed headers", () => {
    const rows = [{ ...storedRow, encryptedUpstreamHeaders: sealedHeaders }];

    it("unseals them on a default read", async () => {
      const { repository } = recordingDatabase({ rows });

      expect((await repository.findAll("org_1"))[0]?.upstreamHeaders).toEqual({
        "X-Token": "s3cret",
      });
    });

    it("unseals nothing on a read with headers: false", async () => {
      const { repository, unsealed } = recordingDatabase({ rows });

      const all = await repository.findAll("org_1", { headers: false });

      expect(all.map((target) => target.upstreamHeaders)).toEqual([{}]);
      expect(unsealed).toEqual([]);
    });

    it("reads one project's live targets only", async () => {
      const { repository, calls } = recordingDatabase({ rows });

      await repository.findByProject({ organizationId: "org_1", projectId: "p1" });

      expect(calls.findMany[0]).toMatchObject({
        where: { organizationId: "org_1", projectId: "p1", archivedAt: null },
      });
    });
  });

  describe("given the allow-list columns", () => {
    it("answers null when the target is not restricted, whatever the list holds", async () => {
      const { repository } = recordingDatabase({
        rows: [{ ...storedRow, restrictToAllowList: false, allowedVirtualKeyIds: ["vk_1"] }],
      });

      expect((await repository.findAll("org_1"))[0]?.allowedVirtualKeyIds).toBeNull();
    });

    it("answers an empty list when the target is restricted to no key", async () => {
      const { repository } = recordingDatabase({
        rows: [{ ...storedRow, restrictToAllowList: true, allowedVirtualKeyIds: [] }],
      });

      expect((await repository.findAll("org_1"))[0]?.allowedVirtualKeyIds).toEqual([]);
    });

    it("writes null as unrestricted and an empty list as restricted to no key", async () => {
      const { repository, calls } = recordingDatabase();

      await repository.create({ ...input, allowedVirtualKeyIds: null });
      await repository.create({ ...input, allowedVirtualKeyIds: [] });
      await repository.update({
        id: "gateway_01",
        organizationId: "org_1",
        allowedVirtualKeyIds: null,
        actorUserId: "user_1",
      });
      await repository.update({
        id: "gateway_01",
        organizationId: "org_1",
        agentName: "Renamed",
        actorUserId: "user_1",
      });

      const columns = [...calls.create, ...calls.update].map((args) => {
        const { data } = args as { data: Partial<Row> };
        return [data.restrictToAllowList, data.allowedVirtualKeyIds];
      });
      expect(columns).toEqual([
        [false, []],
        [true, []],
        [false, []],
        [undefined, undefined],
      ]);
    });
  });

  describe("when an edit replaces the headers", () => {
    it("seals the new set and stores an empty set as no sealed value", async () => {
      const { repository, calls } = recordingDatabase();
      const ref = { id: "gateway_01", organizationId: "org_1", actorUserId: "user_1" };

      await repository.update({ ...ref, upstreamHeaders: { "X-Token": "s3cret" } });
      await repository.update({ ...ref, upstreamHeaders: {} });

      const sealed = (calls.update as { data: Row }[]).map(
        (args) => args.data.encryptedUpstreamHeaders,
      );
      expect(sealed).toEqual([sealedHeaders, null]);
    });
  });

  describe("when an upstream move carries the upstream it was checked against", () => {
    const move = {
      id: "gateway_01",
      organizationId: "org_1",
      upstreamUrl: "https://agents.acme.test/a2a",
      actorUserId: "user_1",
    };

    it("matches the stored URL and header presence in the same update", async () => {
      const { repository, calls } = recordingDatabase();

      await repository.update({
        ...move,
        expectedUpstream: { upstreamUrl: input.upstreamUrl, hasUpstreamHeaders: false },
      });
      await repository.update({
        ...move,
        expectedUpstream: { upstreamUrl: input.upstreamUrl, hasUpstreamHeaders: true },
      });

      expect(calls.update.map((args) => (args as { where: unknown }).where)).toEqual([
        {
          id: "gateway_01",
          organizationId: "org_1",
          upstreamUrl: input.upstreamUrl,
          encryptedUpstreamHeaders: null,
        },
        {
          id: "gateway_01",
          organizationId: "org_1",
          upstreamUrl: input.upstreamUrl,
          encryptedUpstreamHeaders: { not: null },
        },
      ]);
    });

    it("refuses with the headers-need-replacing code once the stored row no longer matches", async () => {
      const { repository } = recordingDatabase({
        updateFailure: Object.assign(new Error("Record to update not found"), { code: "P2025" }),
      });

      await expect(
        repository.update({
          ...move,
          expectedUpstream: { upstreamUrl: input.upstreamUrl, hasUpstreamHeaders: false },
        }),
      ).rejects.toMatchObject({ code: "gateway_a2a_target_headers_need_replacing" });
    });

    it("passes a missing row through on an unguarded edit", async () => {
      const failure = Object.assign(new Error("Record to update not found"), { code: "P2025" });
      const { repository } = recordingDatabase({ updateFailure: failure });

      await expect(repository.update(move)).rejects.toBe(failure);
    });
  });

  describe("when a target is archived", () => {
    it("stamps the archive time and answers the archived row", async () => {
      const { repository, calls } = recordingDatabase();

      const archived = await repository.archive({ id: "gateway_01", organizationId: "org_1" });

      expect(calls.update[0]).toMatchObject({
        where: { id: "gateway_01", organizationId: "org_1" },
        data: { archivedAt: expect.any(Date) },
      });
      expect(archived.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("when the live-name index refuses the insert", () => {
    it("refuses with the name-taken code", async () => {
      const repository = repositoryRejectingCreate(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      await expect(repository.create(input)).rejects.toMatchObject({
        code: "gateway_a2a_target_name_taken",
      });
    });
  });

  describe("when the insert fails for another reason", () => {
    it("passes the error through", async () => {
      const failure = new Error("connection reset");
      const repository = repositoryRejectingCreate(failure);

      await expect(repository.create(input)).rejects.toBe(failure);
    });
  });
});
