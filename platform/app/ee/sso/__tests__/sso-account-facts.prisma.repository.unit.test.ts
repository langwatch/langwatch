import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaSsoAccountFactsRepository } from "../sso-account-facts.prisma.repository";

describe("PrismaSsoAccountFactsRepository", () => {
  const account = {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  const user = { findUnique: vi.fn() };
  const ssoConnection = { findFirst: vi.fn() };
  const repository = new PrismaSsoAccountFactsRepository({
    account,
    user,
    ssoConnection,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts native accounts by user", async () => {
    account.count.mockResolvedValue(2);

    await expect(repository.countForUser({ userId: "user_1" })).resolves.toBe(
      2,
    );
    expect(account.count).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });

  it("returns native providers newest first", async () => {
    account.findMany.mockResolvedValue([
      { provider: "ssoc_new" },
      { provider: "auth0" },
    ]);

    await expect(
      repository.findAccountProvidersForUser({ userId: "user_1" }),
    ).resolves.toEqual(["ssoc_new", "auth0"]);
    expect(account.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { provider: true },
      orderBy: { createdAt: "desc" },
    });
  });

  it("distinguishes a missing user from an unverified user with no accounts", async () => {
    user.findUnique.mockResolvedValue(null);
    account.count.mockResolvedValue(0);

    await expect(
      repository.findCandidate({ userId: "missing" }),
    ).resolves.toBeNull();

    user.findUnique.mockResolvedValue({ emailVerified: false });

    await expect(
      repository.findCandidate({ userId: "user_1" }),
    ).resolves.toEqual({ holdsVerifiedEmail: false, attachedAccounts: 0 });
  });

  it("refuses test evidence before reading accounts for another organization's connection", async () => {
    ssoConnection.findFirst.mockResolvedValue(null);

    await expect(
      repository.findLatestForConnection({
        organizationId: "org_other",
        connectionId: "ssoc_acme",
      }),
    ).resolves.toBeNull();
    expect(ssoConnection.findFirst).toHaveBeenCalledWith({
      where: { id: "ssoc_acme", organizationId: "org_other" },
      select: { id: true },
    });
    expect(account.findFirst).not.toHaveBeenCalled();
  });

  it("returns the latest test sign-in for an owned connection", async () => {
    const createdAt = new Date("2026-09-17T08:00:00.000Z");
    ssoConnection.findFirst.mockResolvedValue({ id: "ssoc_acme" });
    account.findFirst.mockResolvedValue({
      id: "account_1",
      userId: "user_1",
      createdAt,
    });

    await expect(
      repository.findLatestForConnection({
        organizationId: "org_acme",
        connectionId: "ssoc_acme",
      }),
    ).resolves.toEqual({
      accountId: "account_1",
      userId: "user_1",
      atMs: createdAt.getTime(),
    });
    expect(account.findFirst).toHaveBeenCalledWith({
      where: { provider: "ssoc_acme" },
      select: { id: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });
});
