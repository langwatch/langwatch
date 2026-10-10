/**
 * @vitest-environment node
 *
 * The erasure commits user's erased fact inside its own transaction: a rolled-back erase leaves
 * no erased fact, and a fact that cannot be written rolls the erase back.
 * @see modules/user/specs/data-erasure.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaGdprUserDataEraseRepository } from "../prisma.user-data-erase.repository.ts";

/** The erase transaction's writes, for a user who owns nothing, recorded in the order seen. */
function databaseRecording({ failOn }: { failOn?: string } = {}) {
  const writes: string[] = [];
  const outboxRows: unknown[] = [];
  const write = (name: string) =>
    vi.fn(async () => {
      if (failOn === name) throw new Error(`${name} unavailable`);
      writes.push(name);
      return { count: 0 };
    });
  const outboxCreateMany = vi.fn(async (args?: { data: unknown }) => {
    if (failOn === "outbox") throw new Error("outbox unavailable");
    const rows = [args?.data].flat();
    outboxRows.push(...rows);
    const keys = rows.map((row) => (row as { messageKey?: unknown } | undefined)?.messageKey);
    writes.push(`outbox:${keys.join(",")}`);
    return { count: rows.length };
  });
  const state = { committed: false };
  const client: PrismaClient = prismaDouble({
    annotation: { updateMany: write("annotation.updateMany") },
    shareLink: { updateMany: write("shareLink.updateMany") },
    workflow: { updateMany: write("workflow.updateMany") },
    workflowVersion: { deleteMany: write("workflowVersion.deleteMany") },
    llmPromptConfigVersion: { updateMany: write("llmPromptConfigVersion.updateMany") },
    annotationQueueItem: { updateMany: write("annotationQueueItem.updateMany") },
    auditLog: { updateMany: write("auditLog.updateMany") },
    annotationQueueMembers: { deleteMany: write("annotationQueueMembers.deleteMany") },
    teamUser: { deleteMany: write("teamUser.deleteMany") },
    organizationUser: {
      deleteMany: write("organizationUser.deleteMany"),
      findMany: async () => [{ organizationId: "org_shared" }],
    },
    account: { deleteMany: write("account.deleteMany") },
    session: { deleteMany: write("session.deleteMany") },
    user: { delete: write("user.delete") },
    processManagerOutbox: { createMany: outboxCreateMany, findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (prisma: PrismaClient) => Promise<unknown>) => {
      const result = await callback(client);
      state.committed = true;
      return result;
    }),
  });
  const repository = PrismaGdprUserDataEraseRepository.create({ database: client });
  return { repository, writes, state, outboxRows };
}

const ERASE = { userId: "user-1", projectIds: [], soleOwnedTeamIds: [], soleOwnedOrgIds: [] };

describe("PrismaGdprUserDataEraseRepository's erased fact", () => {
  /** @scenario "An erasure records user's erased fact with the erase" */
  it("appends the erased fact in the erase's transaction, after the user row goes", async () => {
    const { repository, writes, state, outboxRows } = databaseRecording();

    await repository.eraseUserAndOwnedResources(ERASE);

    expect(writes.slice(-2)).toEqual(["user.delete", "outbox:user-1:erased"]);
    expect(state.committed).toBe(true);
    expect(JSON.stringify(outboxRows)).toContain('"organizationIds":["org_shared"]');
  });

  /** @scenario "An erasure that rolls back records no erased fact" */
  it("writes no erased fact when the erase fails part-way", async () => {
    const { repository, writes, state } = databaseRecording({ failOn: "user.delete" });

    await expect(repository.eraseUserAndOwnedResources(ERASE)).rejects.toThrow(
      "user.delete unavailable",
    );

    expect(writes.filter((write) => write.startsWith("outbox"))).toEqual([]);
    expect(state.committed).toBe(false);
  });

  /** @scenario "An erasure that rolls back records no erased fact" */
  it("rolls the erase back when its fact cannot be written", async () => {
    const { repository, state } = databaseRecording({ failOn: "outbox" });

    await expect(repository.eraseUserAndOwnedResources(ERASE)).rejects.toThrow(
      "outbox unavailable",
    );
    expect(state.committed).toBe(false);
  });
});
