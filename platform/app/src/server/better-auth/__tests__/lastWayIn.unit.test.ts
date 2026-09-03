import { describe, expect, it, vi } from "vitest";

// The guard under test is constructed here, over the real service and an
// in-memory stand-in for its two reads.
import { LastWayInService } from "~/server/app-layer/identity/last-way-in.service";
import { isLastWayInPath, LastWayInGuard } from "../last-way-in";

/**
 * ADR-119 on the two removals that reached no ceremony
 * (specs/identity/authentication-settings.feature).
 *
 * The detach guard runs on `account.delete.before`, so it sees every removal
 * that goes through better-auth's `account` model. A passkey does not — the
 * plugin owns its own table — and the plugin's `/two-factor/disable` is
 * mounted beside the tRPC procedure that refuses properly. Both were doors
 * out of an account with nothing behind them.
 *
 * The guard is driven over the REAL service, over an in-memory stand-in for
 * the two rows it reads: the refusal and the count that earns it are one
 * decision, and a fake service would leave the half that decides unasserted.
 */

const guardOver = ({
  otherPasskeys = 0,
  credentials = [] as { provider: string; password: string | null }[],
}) => {
  const countOtherPasskeys = vi.fn().mockResolvedValue(otherPasskeys);
  const findCredentials = vi.fn().mockResolvedValue(credentials);
  const guard = new LastWayInGuard({
    lastWayIn: new LastWayInService({
      records: { countOtherPasskeys, findCredentials },
    }),
  });
  return { guard, countOtherPasskeys, findCredentials };
};

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
      const { guard } = guardOver({ otherPasskeys: 0, credentials: [] });

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_only" },
          requiringOrganizations: noOrganizationRequires,
        }),
      ).rejects.toThrow(/only way you can sign in/i);
    });

    it("refuses when the credential row holds no password", async () => {
      // A passwordless account signed up with a passkey. The row exists; it
      // is not a way in.
      const { guard } = guardOver({
        otherPasskeys: 0,
        credentials: [{ provider: "credential", password: null }],
      });

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_only" },
          requiringOrganizations: noOrganizationRequires,
        }),
      ).rejects.toThrow(/only way you can sign in/i);
    });

    it("counts the passkeys they hold besides the one going", async () => {
      const { guard, countOtherPasskeys } = guardOver({ otherPasskeys: 0 });

      await guard
        .refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_only" },
          requiringOrganizations: noOrganizationRequires,
        })
        .catch(() => void 0);

      expect(countOtherPasskeys).toHaveBeenCalledWith({
        userId: "user_ana",
        exceptPasskeyId: "passkey_only",
      });
    });
  });

  describe("when another way in survives it", () => {
    it.each([
      ["a second passkey", { otherPasskeys: 1, credentials: [] }],
      [
        "a password",
        {
          otherPasskeys: 0,
          credentials: [{ provider: "credential", password: "hashed" }],
        },
      ],
      [
        "a federated account",
        {
          otherPasskeys: 0,
          credentials: [{ provider: "okta", password: null }],
        },
      ],
    ])("allows the removal when they still have %s", async (_case, setup) => {
      const { guard } = guardOver(setup);

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: { id: "passkey_going" },
          requiringOrganizations: noOrganizationRequires,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the body names no passkey", () => {
    it("decides nothing, because there is no removal to weigh", async () => {
      const { guard, countOtherPasskeys } = guardOver({});

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/passkey/delete-passkey",
          userId: "user_ana",
          body: {},
          requiringOrganizations: noOrganizationRequires,
        }),
      ).resolves.toBeUndefined();
      expect(countOtherPasskeys).not.toHaveBeenCalled();
    });
  });
});

describe("given somebody turning off their second factor", () => {
  describe("when an organization they belong to requires one", () => {
    it("refuses, the way the tRPC procedure does", async () => {
      const { guard } = guardOver({});

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/two-factor/disable",
          userId: "user_ana",
          body: {},
          requiringOrganizations: async () => [{ slug: "acme" }],
        }),
      ).rejects.toThrow(/organization requires a second step/i);
    });
  });

  describe("when no organization requires one", () => {
    it("lets it through", async () => {
      const { guard } = guardOver({});

      await expect(
        guard.refuseIfItClosesTheLastDoor({
          pathname: "/two-factor/disable",
          userId: "user_ana",
          body: {},
          requiringOrganizations: noOrganizationRequires,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given a call with no session behind it", () => {
  it("decides nothing, because better-auth refuses it first", async () => {
    const { guard, countOtherPasskeys } = guardOver({});

    await expect(
      guard.refuseIfItClosesTheLastDoor({
        pathname: "/passkey/delete-passkey",
        userId: null,
        body: { id: "passkey_only" },
        requiringOrganizations: noOrganizationRequires,
      }),
    ).resolves.toBeUndefined();
    expect(countOtherPasskeys).not.toHaveBeenCalled();
  });
});
