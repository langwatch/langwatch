import type { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaDatasetRecordRepository } from "../prisma.dataset-record.repository.ts";

const input = {
  datasetId: "dataset-1",
  projectId: "project-1",
  entries: [{ id: "row-1", input: "same" }],
  skipDuplicates: true,
  verifyExisting: true,
};

function fixture(storedInput: string) {
  const row = {
    id: "row-1",
    datasetId: input.datasetId,
    projectId: input.projectId,
    entry: { input: storedInput },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const query = vi.fn().mockResolvedValue([row]);
  const lock = vi.fn().mockResolvedValue(1);
  const client = prismaDouble({
    datasetRecord: { createMany },
    $queryRaw: query,
    $executeRaw: lock,
  });
  const transaction = vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    work(client),
  );
  const repository = PrismaDatasetRecordRepository.create({
    prisma: prismaDouble({ $transaction: transaction }),
  });
  return { repository, transaction, createMany, query, lock, row };
}

describe("a verified dataset retry in a Prisma transaction", () => {
  /** @scenario "A verified retry is atomic and compares complete normalized entries" */
  it("opens a serializable transaction for standalone verification", async () => {
    const { repository, transaction, createMany, query, lock, row } = fixture("same");

    await expect(repository.createMany(input)).resolves.toEqual([row]);

    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(createMany).toHaveBeenCalledExactlyOnceWith({
      data: [
        {
          id: "row-1",
          datasetId: input.datasetId,
          projectId: input.projectId,
          entry: { input: "same" },
        },
      ],
      skipDuplicates: true,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(lock).not.toHaveBeenCalled();
  });

  it("uses the lock-bound client without opening a nested transaction", async () => {
    const { repository, transaction, createMany, query, lock, row } = fixture("same");

    await expect(
      repository.withDatasetLock(input, (records) => records.createMany(input)),
    ).resolves.toEqual([row]);

    expect(transaction).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(createMany.mock.invocationCallOrder[0]!);
    expect(createMany.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]!);
  });

  it("propagates a mismatch out of the lock transaction so it cannot commit", async () => {
    const { repository, transaction, createMany, query } = fixture("different");

    await expect(
      repository.withDatasetLock(input, (records) => records.createMany(input)),
    ).rejects.toMatchObject({ code: "dataset_record_conflict" });

    expect(transaction).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    await expect(transaction.mock.results[0]?.value).rejects.toMatchObject({
      code: "dataset_record_conflict",
    });
  });
});
