import { IdentityPrimaryMustDemoteFirstError } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";
import { IdentityCeremonies } from "../better-auth/identity-ceremonies";
import type { IdentityUsersRepository } from "../identity-users.repository";
import { fact, InMemoryHeads, T0, USER } from "./support/in-memory-heads";

function harness(options?: {
  latched?: boolean;
  email?: string | null;
  identifierForAccount?: string | null;
  attach?: () => Promise<never>;
  detach?: () => Promise<never>;
}) {
  const heads = new InMemoryHeads();
  if (options?.identifierForAccount !== undefined) {
    heads.heads.set(USER, {
      userId: USER,
      identifiers:
        options.identifierForAccount === null
          ? {}
          : {
              [options.identifierForAccount]: fact({
                identifierId: options.identifierForAccount,
                accountId: "acc_1",
                provider: "google",
              }),
            },
    });
  }

  const users: IdentityUsersRepository = {
    storeUserHashKeyIfMissing: vi.fn().mockResolvedValue(undefined),
    findEmail: vi
      .fn()
      .mockResolvedValue(options?.email === undefined ? "sam@acme.com" : options.email),
    // The ceremonies never ask it — the collision guard does, one layer
    // down — but the double is the whole port.
    findUserIdByEmail: vi.fn().mockResolvedValue(null),
  };
  const identity = {
    attachIdentifier: vi.fn(options?.attach ?? (async () => [])),
    detachIdentifier: vi.fn(options?.detach ?? (async () => [])),
    eraseUser: vi.fn(async () => []),
  };
  let minted = 0;
  const ceremonies = new IdentityCeremonies(
    heads,
    users,
    identity as never,
    async () => options?.latched ?? true,
    { now: () => T0, newCommandId: () => `idcmd_${++minted}` },
  );
  return { ceremonies, identity, users, heads };
}

const accountRow = (overrides?: Record<string, unknown>) => ({
  id: "acc_1",
  userId: USER,
  providerId: "google",
  accountId: "gid_1",
  createdAt: new Date(T0),
  ...overrides,
});

describe("the identity ceremonies", () => {
  describe("given a user whose backfill has not latched", () => {
    /** @scenario "The write gate ships closed for every user" */
    it("emits nothing and leaves the row write untouched", async () => {
      const { ceremonies, identity } = harness({ latched: false });

      expect(await ceremonies.beforeAccountCreate(accountRow())).toBeUndefined();
      await ceremonies.beforeAccountDelete(accountRow());
      await ceremonies.beforeUserDelete({ id: USER });

      expect(identity.attachIdentifier).not.toHaveBeenCalled();
      expect(identity.detachIdentifier).not.toHaveBeenCalled();
      expect(identity.eraseUser).not.toHaveBeenCalled();
    });

    /** @scenario "Deleting an unlatched user runs no ceremony; the erasure service reconciles" */
    it("deletes the user with no erase ceremony; the backfill reconciles", async () => {
      const { ceremonies, identity } = harness({ latched: false });

      // The hook returns without refusing, so better-auth deletes the row
      // exactly as it would with no ceremonies wired.
      await expect(ceremonies.beforeUserDelete({ id: USER })).resolves.toBeUndefined();
      expect(identity.eraseUser).not.toHaveBeenCalled();
    });
  });

  describe("when a latched user's account row is about to be created", () => {
    /** @scenario "A latched user's domain-significant writes produce events structurally" */
    it("attaches the identifier and pins the row id it derived from", async () => {
      const { ceremonies, identity } = harness();

      const result = await ceremonies.beforeAccountCreate(accountRow());

      // The row keeps the id the ceremony saw, so the identifier id the
      // backfill later derives from this row is the same id.
      expect(result).toEqual({ data: { id: "acc_1" } });
      expect(identity.attachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          accountId: "acc_1",
          provider: "google",
          providerId: "google",
          providerAccountId: "gid_1",
          value: "sam@acme.com",
          occurredAtMs: T0,
          ceremony: { flow: "better-auth" },
        }),
      );
    });

    /** @scenario "The projected Account row keeps better-auth's own provider id" */
    it("carries better-auth's own provider id, unfolded, beside the folded one", async () => {
      const { ceremonies, identity } = harness();

      await ceremonies.beforeAccountCreate(
        accountRow({ providerId: "auth0", accountId: "auth0|42" }),
      );

      // The identifier vocabulary folds auth0 into `oidc`, and `Account` is a
      // projection of the log: a fact that carried only the folded name would
      // make the fold rewrite the row's provider and the genericOAuth
      // callback's lookup would stop finding it.
      expect(identity.attachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "oidc", providerId: "auth0" }),
      );
    });

    it("mints the row id when better-auth supplied none", async () => {
      const { ceremonies, identity } = harness();

      const result = await ceremonies.beforeAccountCreate(accountRow({ id: undefined }));

      const minted = (result as { data: { id: string } }).data.id;
      expect(minted).toBeTruthy();
      expect(identity.attachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: minted }),
      );
    });

    it("attaches nothing when the user carries no email value", async () => {
      const { ceremonies, identity } = harness({ email: null });

      expect(await ceremonies.beforeAccountCreate(accountRow())).toBeUndefined();
      expect(identity.attachIdentifier).not.toHaveBeenCalled();
    });

    /** @scenario "A latched user's domain-significant writes produce events structurally" */
    it("propagates a guard refusal, so better-auth never writes the row", async () => {
      const { ceremonies } = harness({
        attach: async () => {
          throw new IdentityPrimaryMustDemoteFirstError("refused");
        },
      });

      await expect(ceremonies.beforeAccountCreate(accountRow())).rejects.toBeInstanceOf(
        IdentityPrimaryMustDemoteFirstError,
      );
    });
  });

  describe("when a latched user's account row is about to be deleted", () => {
    it("detaches the identifier the row mirrors", async () => {
      const { ceremonies, identity } = harness({
        identifierForAccount: "idf_google",
      });

      await ceremonies.beforeAccountDelete(accountRow());

      expect(identity.detachIdentifier).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER, identifierId: "idf_google" }),
      );
    });

    /** @scenario "An Account row no identifier mirrors still deletes" */
    it("detaches nothing when no identifier unambiguously mirrors the row", async () => {
      const { ceremonies, identity } = harness({ identifierForAccount: null });

      await ceremonies.beforeAccountDelete(accountRow());

      expect(identity.detachIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when a latched user is about to be deleted", () => {
    /** @scenario "Deleting a latched user runs the erase ceremony before the row delete" */
    it("erases the user before the row goes", async () => {
      const { ceremonies, identity } = harness();

      await ceremonies.beforeUserDelete({ id: USER });

      expect(identity.eraseUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER, tenantId: USER }),
      );
    });
  });

  describe("when a user row is created on an unmigrated organization", () => {
    /** @scenario "Signing up on an unmigrated organization writes nothing extra" */
    it("has no hook to run: the backfill owns the hash-key mint", async () => {
      const { ceremonies, users } = harness({ latched: false });

      // There is deliberately no user.create ceremony. The mint used to live
      // there ungated, which made a sign-up on an unmigrated organization
      // write `User.userHashKey` it otherwise would not have.
      expect((ceremonies as unknown as Record<string, unknown>).afterUserCreate).toBeUndefined();
      expect(users.storeUserHashKeyIfMissing).not.toHaveBeenCalled();
    });
  });
});
