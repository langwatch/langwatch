import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  isLastWayInPath,
  refuseIfItClosesTheLastDoor,
} from "../last-way-in";

/**
 * ADR-119 on the two removals that reached no ceremony
 * (specs/identity/authentication-settings.feature).
 *
 * The detach guard runs on `account.delete.before`, so it sees every removal
 * that goes through better-auth's `account` model. A passkey does not — the
 * plugin owns its own table — and the plugin's `/two-factor/disable` is
 * mounted beside the tRPC procedure that refuses properly. Both were doors
 * out of an account with nothing behind them.
 */

const prismaWith = ({
  otherPasskeys = 0,
  accounts = [] as { provider: string; password: string | null }[],
}) =>
  ({
    passkey: { count: vi.fn().mockResolvedValue(otherPasskeys) },
    account: { findMany: vi.fn().mockResolvedValue(accounts) },
  }) as unknown as PrismaClient;

const noOrganizationRequires = async () => [];

describe("given the paths that can close a door", () => {
  it("answers for the two that reach no ceremony, and nothing else", () => {
    expect(isLastWayInPath("/passkey/delete-passkey")).toBe(true);
    expect(isLastWayInPath("/two-factor/disable")).toBe(true);
    expect(isLastWayInPath("/sign-in/email")).toBe(false);
    expect(isLastWayInPath("/two-factor/enable")).toBe(false);
  });
});

describe("given somebody removing a passkey", () => {
  describe("when it is the only way they can sign in", () => {
    it("refuses before the plugin deletes it", async () => {
      await expect(
        refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_only" },
          prisma: prismaWith({ otherPasskeys: 0, accounts: [] }),
          requiringOrganizations: noOrganizationRequires,
        }),
      ).rejects.toThrow(/only way you can sign in/i);
    });

    it("refuses when the credential row holds no password", async () => {
      // A passwordless account signed up with a passkey. The row exists; it
      // is not a way in.
      await expect(
        refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_only" },
          prisma: prismaWith({
            otherPasskeys: 0,
            accounts: [{ provider: "credential", password: null }],
          }),
          requiringOrganizations: noOrganizationRequires,
        }),
      ).rejects.toThrow(/only way you can sign in/i);
    });
  });

  describe("when another way in survives it", () => {
    it.each([
      [
        "a second passkey",
        { otherPasskeys: 1, accounts: [] },
      ],
      [
        "a password",
        {
          otherPasskeys: 0,
          accounts: [{ provider: "credential", password: "hashed" }],
        },
      ],
      [
        "a federated account",
        {
          otherPasskeys: 0,
          accounts: [{ provider: "okta", password: null }],
        },
      ],
    ])("allows the removal when they still have %s", async (_case, setup) => {
      await expect(
        refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_going" },
          prisma: prismaWith(setup),
          requiringOrganizations: noOrganizationRequires,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given somebody turning off their second factor", () => {
  describe("when an organization they belong to requires one", () => {
    it("refuses, the way the tRPC procedure does", async () => {
      await expect(
        refuseIfItClosesTheLastDoor({
          pathname: "/two-factor/disable",
          userId: "user_ana",
          body: {},
          prisma: prismaWith({}),
          requiringOrganizations: async () => [{ slug: "acme" }],
        }),
      ).rejects.toThrow(/organization requires a second step/i);
    });
  });

  describe("when no organization requires one", () => {
    it("lets it through", async () => {
      await expect(
        refuseIfItClosesTheLastDoor({
          pathname: "/two-factor/disable",
          userId: "user_ana",
          body: {},
          prisma: prismaWith({}),
          requiringOrganizations: noOrganizationRequires,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given a call with no session behind it", () => {
  it("decides nothing, because better-auth refuses it first", async () => {
    const prisma = prismaWith({});
    await expect(
      refuseIfItClosesTheLastDoor({
        pathname: "/passkey/delete-passkey",
        userId: null,
        body: { id: "passkey_only" },
        prisma,
        requiringOrganizations: noOrganizationRequires,
      }),
    ).resolves.toBeUndefined();
    expect(prisma.passkey.count).not.toHaveBeenCalled();
  });
});
