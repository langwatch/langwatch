/**
 * @vitest-environment node
 * @see modules/auth/specs/sign-up.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaSignUpVerificationTokenRepository } from "../prisma.signup-verification-token.repository.ts";

describe("PrismaSignUpVerificationTokenRepository.claim", () => {
  /** @scenario "Two openings of one sign-up confirmation link spend it only once" */
  it("rechecks the live row in one conditional write", async () => {
    const identifier = "identity-signup:sam@example.com";
    const token = "confirm-1";
    const findFirst = vi.fn(async () => ({
      identifier,
      expires: new Date("2030-01-01T00:00:00.000Z"),
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn(async () => 1);
    const database = {
      $executeRaw: executeRaw,
      verificationToken: { findFirst, updateMany },
    } as unknown as Parameters<typeof PrismaSignUpVerificationTokenRepository.create>[0]["prisma"];
    const repository = PrismaSignUpVerificationTokenRepository.create({ prisma: database });

    await expect(
      repository.claim({
        token,
        now: Temporal.Instant.from("2029-01-01T00:00:00Z"),
        keepSpentUntil: Temporal.Instant.from("2031-01-01T00:00:00Z"),
      }),
    ).resolves.toEqual({ claimed: true, identifier });

    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] ?? [];
    const sql = Array.from(strings as readonly string[]).join("?");
    expect(sql).toContain('UPDATE "VerificationToken"');
    expect(sql).toContain('"identifier" NOT LIKE ?');
    expect(sql).toContain('"expires" > ?');
    expect(values).toContain(token);
    expect(values).toContain(identifier);
    expect(values).toContain("identity-signup-spent:identity-signup:sam@example.com");
  });
});
