/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaActivationCodeRepository } from "../prisma.activation-code.repository.ts";

describe("PrismaActivationCodeRepository.revoke", () => {
  /** @scenario "Exactly one of two simultaneous revokes marks an activation code" */
  it("decides the revocation in one conditional write", async () => {
    const executeRaw = vi.fn(async () => 1);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const database = {
      $executeRaw: executeRaw,
      activationCode: { updateMany },
    } as unknown as Parameters<typeof PrismaActivationCodeRepository.create>[0];
    const repository = PrismaActivationCodeRepository.create(database);
    const at = nowInstant();

    await expect(
      repository.revoke({ id: "code-1", at, revokedById: "user-operator" }),
    ).resolves.toBe(true);

    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] ?? [];
    const sql = Array.from(strings as readonly string[]).join("?");
    expect(sql).toContain('UPDATE "ActivationCode"');
    expect(sql).toContain('"revokedAt" IS NULL');
    expect(sql).toContain('"revokedById" = ?');
    expect(values).toContain("code-1");
    expect(values).toContain("user-operator");
  });
});
