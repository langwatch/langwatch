// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's erasure marks through the tenancy guards: written once however often, and read back
 * by id across more ids than one bounded read takes.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { erasedUserHashOf } from "../../../rules/nurturing-virtual-key.rules.ts";
import { PrismaNurturingErasedUserRepository } from "../prisma.nurturing-erased-user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const person = (index: number) => `test-nurturing-erased-${index}-${run}`;
// One in the second 1,000-id read and one in the third, so a read of the first alone misses both.
const erased = [person(1_500), person(2_200)];

/** The client, recording how many ids each read of the marks asks for. */
function countingReads(client: PrismaConnection["client"], reads: number[]) {
  const findMany = (args: { where: { userIdHash: { in: string[] } } }) => {
    reads.push(args.where.userIdHash.in.length);
    return client.nurturingErasedUser.findMany(args);
  };
  const marks = new Proxy(client.nurturingErasedUser, {
    get: (target, property) => (property === "findMany" ? findMany : Reflect.get(target, property)),
  });
  return new Proxy(client, {
    get: (target, property) =>
      property === "nurturingErasedUser" ? marks : Reflect.get(target, property),
  });
}

describe.skipIf(!databaseUrl)("PrismaNurturingErasedUserRepository", () => {
  let connection: PrismaConnection;
  let erasedUsers: PrismaNurturingErasedUserRepository;
  const reads: number[] = [];

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:erased-user"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    erasedUsers = PrismaNurturingErasedUserRepository.create({
      prisma: countingReads(connection.client, reads),
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingErasedUser.deleteMany({
      where: { userIdHash: { in: erased.map(erasedUserHashOf) } },
    });
    await connection.closeOnce();
  });

  describe("when two people are marked, one of them twice, and 2,500 people are asked after", () => {
    /** @scenario "Which people are erased is read from the erasure marks in Postgres" */
    it("names only the two marked people, each once, in reads of at most 1,000 ids", async () => {
      for (const userId of [...erased, erased[0] ?? ""]) {
        await erasedUsers.markErased({ userId });
      }
      const asked = Array.from({ length: 2_500 }, (_, index) => person(index));

      const found = await erasedUsers.findErased({ userIds: [...asked, ...erased] });

      expect(found.toSorted()).toEqual(erased.toSorted());
      await expect(erasedUsers.findErased({ userIds: [] })).resolves.toEqual([]);
      // 2,500 distinct ids, the two repeated ones read once; the empty list reads nothing.
      expect(reads).toEqual([1_000, 1_000, 500]);
    });
  });
});
