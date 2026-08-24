import { describe, expect, it, vi } from "vitest";
import type {
  AccountCredentialRow,
  AccountCredentialsRepository,
} from "../account-credentials.repository";
import { IdentityAccountStore } from "../better-auth/account-store";
import { fact, InMemoryHeads, T0, USER } from "./support/in-memory-heads";

const IDENTIFIER = "idf_google";
const ACCOUNT = "acc_1";
const SUBJECT = "sub-12345";

function credential(
  overrides?: Partial<AccountCredentialRow>,
): AccountCredentialRow {
  return {
    id: ACCOUNT,
    identifierId: IDENTIFIER,
    type: "oauth",
    accessToken: "at_1",
    refreshToken: "rt_1",
    idToken: null,
    password: null,
    scope: "openid email",
    tokenType: "Bearer",
    sessionState: null,
    expiresAtMs: T0 + 3_600_000,
    extExpiresIn: null,
    createdAtMs: T0,
    updatedAtMs: T0,
    ...overrides,
  };
}

function harness(options?: {
  onIdentity?: boolean;
  state?: "VERIFIED" | "DETACHED";
  credentials?: AccountCredentialRow[];
}) {
  const heads = new InMemoryHeads();
  heads.heads.set(USER, {
    userId: USER,
    identifiers: {
      [IDENTIFIER]: fact({
        identifierId: IDENTIFIER,
        provider: "google",
        providerAccountId: SUBJECT,
        accountId: ACCOUNT,
        state: options?.state ?? "VERIFIED",
      }),
    },
  });

  const rows = options?.credentials ?? [credential()];
  const repo: AccountCredentialsRepository = {
    findById: vi.fn(async ({ id }) => rows.find((r) => r.id === id) ?? null),
    findByIdentifierIds: vi.fn(async ({ identifierIds }) =>
      rows.filter((r) => identifierIds.includes(r.identifierId)),
    ),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    updateMany: vi.fn(async () => rows.length),
    deleteByIds: vi.fn(async ({ ids }) => ids.length),
  };

  const store = new IdentityAccountStore(
    heads,
    repo,
    async () => options?.onIdentity ?? true,
  );
  return { store, repo, heads };
}

describe("the identity account store", () => {
  describe("when an IdP callback presents its subject", () => {
    /** @scenario "better-auth reads an account from the identifiers" */
    it("answers the account, joined from the identifier and its secrets", async () => {
      const { store } = harness();

      const row = await store.findOne({
        where: [
          { field: "accountId", value: SUBJECT },
          { field: "providerId", value: "google" },
        ],
      });

      expect(row).toMatchObject({
        id: ACCOUNT,
        userId: USER,
        providerId: "google",
        // better-auth's `accountId` is the PROVIDER's subject, not a row id.
        accountId: SUBJECT,
        accessToken: "at_1",
        refreshToken: "rt_1",
      });
    });

    /** @scenario "A tombstoned identifier can never sign anyone in" */
    it("answers nothing for a detached identifier", async () => {
      const { store } = harness({ state: "DETACHED" });

      expect(
        await store.findOne({
          where: [
            { field: "accountId", value: SUBJECT },
            { field: "providerId", value: "google" },
          ],
        }),
      ).toBeNull();
    });

    /** @scenario "An unmigrated user's accounts come from the legacy table" */
    it("answers nothing for a user the gate has closed", async () => {
      const { store } = harness({ onIdentity: false });

      expect(
        await store.findOne({
          where: [
            { field: "accountId", value: SUBJECT },
            { field: "providerId", value: "google" },
          ],
        }),
      ).toBeNull();
    });
  });

  describe("when the identifier has no credential row yet", () => {
    it("still answers: the sign-in method exists, the secrets are absent", async () => {
      const { store } = harness({ credentials: [] });

      const row = await store.findOne({
        where: [{ field: "userId", value: USER }],
      });

      // Hiding it would make a linked account vanish from the user's
      // settings page because a secrets table lagged.
      expect(row).toMatchObject({ id: ACCOUNT, accessToken: null });
    });
  });

  describe("when better-auth refreshes a token", () => {
    /** @scenario "A token refresh touches secrets and emits no event" */
    it("writes only the credential row", async () => {
      const { store, repo } = harness();

      await store.update({
        where: [{ field: "id", value: ACCOUNT }],
        update: { accessToken: "at_2", expiresAt: new Date(T0 + 7_200_000) },
      });

      expect(repo.updateMany).toHaveBeenCalledWith({
        ids: [ACCOUNT],
        patch: { accessToken: "at_2", expiresAtMs: T0 + 7_200_000 },
      });
    });

    it("writes nothing when the payload carries no credential field", async () => {
      const { store, repo } = harness();

      await store.update({
        where: [{ field: "id", value: ACCOUNT }],
        update: { somethingElse: true },
      });

      expect(repo.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("when an account row is created for a migrated user", () => {
    it("stores the secrets against the identifier the ceremony attached", async () => {
      const { store, repo } = harness({ credentials: [] });

      await store.createCredentialFor({
        row: {
          id: ACCOUNT,
          userId: USER,
          providerId: "google",
          accessToken: "at_new",
        },
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ACCOUNT,
          identifierId: IDENTIFIER,
          accessToken: "at_new",
        }),
      );
    });

    it("answers null when no identifier mirrors the row, so the caller falls back", async () => {
      const { store, repo } = harness({ credentials: [] });

      const written = await store.createCredentialFor({
        row: { id: "acc_unknown", userId: "user_nobody", providerId: "google" },
      });

      expect(written).toBeNull();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
