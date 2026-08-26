// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * Directory provisioning tokens belong to a connection (D05, consuming D08 —
 * see specs/identity/sso-onboarding-tiers.feature).
 *
 * The four promises, exercised against the real `ScimTokenService` over an
 * in-memory stand-in for the two tables it touches: a new token names one
 * connection and shows its secret once, issuing without naming one is
 * refused by name, a token minted before connections existed keeps exactly
 * the reach it had, and removing a connection ends the tokens issued against
 * it.
 *
 * The store is a double rather than Postgres because what is under test is
 * the SERVICE's rules — which token a `where` reaches, what a mint records,
 * what a revoke ends. A row store that answered differently from Postgres
 * would be a bug in the double; the queries themselves are one `where` each
 * and are asserted directly.
 */
import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimTokenService } from "../scim-token.service";

const ORG = "org_acme";
const CONNECTION = "ssoc_okta";
const OTHER_CONNECTION = "ssoc_entra";

interface TokenRow {
  id: string;
  organizationId: string;
  connectionId: string | null;
  hashedToken: string;
  hashScheme: string;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** The two tables the token service reads and writes, in memory. */
function createStore(connections: { id: string; organizationId: string }[]) {
  const tokens: TokenRow[] = [];
  let minted = 0;
  // Equality and `in`, because those are the two shapes the service uses. A
  // double that understood only equality answered "no such token" for the
  // `in` the token lookup issues — which reads as a failing test rather than
  // as a double that cannot express the query.
  const matches = (row: TokenRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([field, value]) => {
      const held = (row as unknown as Record<string, unknown>)[field];
      if (value !== null && typeof value === "object" && "in" in value) {
        return (value as { in: unknown[] }).in.includes(held);
      }
      return held === value;
    });
  return {
    tokens,
    prisma: {
      scimToken: {
        create: vi.fn(async ({ data }: { data: Partial<TokenRow> }) => {
          const row: TokenRow = {
            id: `scimtok_${++minted}`,
            organizationId: data.organizationId!,
            connectionId: data.connectionId ?? null,
            hashedToken: data.hashedToken!,
            hashScheme: data.hashScheme ?? "sha256",
            description: data.description ?? null,
            createdAt: new Date(),
            lastUsedAt: null,
          };
          tokens.push(row);
          return row;
        }),
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            tokens.find((row) => matches(row, where)) ?? null,
        ),
        // `hashedToken` is unique in the schema, so the service asks by it
        // directly when it needs to know whether a value is already taken.
        findUnique: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            tokens.find((row) => matches(row, where)) ?? null,
        ),
        findMany: vi.fn(
          async ({
            where,
            select,
          }: {
            where: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) =>
            tokens
              .filter((row) => matches(row, where))
              // `select` is honoured, because the promise under test is
              // exactly that the listing narrows to the safe fields. A
              // double that returned whole rows would make the assertion
              // about the hash never being listed vacuous.
              .map((row) =>
                select
                  ? Object.fromEntries(
                      Object.entries(row).filter(([field]) => select[field]),
                    )
                  : row,
              ),
        ),
        deleteMany: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            const doomed = tokens.filter((row) => matches(row, where));
            for (const row of doomed) tokens.splice(tokens.indexOf(row), 1);
            return { count: doomed.length };
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Partial<TokenRow>;
          }) => {
            const touched = tokens.filter((row) => matches(row, where));
            for (const row of touched) Object.assign(row, data);
            return { count: touched.length };
          },
        ),
      },
      ssoConnection: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            connections.find(
              (connection) =>
                connection.id === where.id &&
                connection.organizationId === where.organizationId,
            ) ?? null,
        ),
      },
    },
  };
}

const ENTERPRISE = {
  getActivePlan: vi.fn(async () => ({ type: "ENTERPRISE" })),
};

const SYNC_LIFECYCLE = {
  tokenIssued: vi.fn(async () => undefined),
  revoked: vi.fn(async () => undefined),
};

let store: ReturnType<typeof createStore>;
let service: ScimTokenService;

beforeEach(() => {
  vi.clearAllMocks();
  store = createStore([
    { id: CONNECTION, organizationId: ORG },
    { id: OTHER_CONNECTION, organizationId: ORG },
  ]);
  service = ScimTokenService.create(store.prisma as never, {
    planProvider: ENTERPRISE as never,
    syncLifecycle: SYNC_LIFECYCLE as never,
  });
});

describe("directory provisioning tokens", () => {
  describe("when one is issued against a connection", () => {
    /** @scenario "A new directory provisioning token belongs to one connection" */
    it("issues it against the named connection and shows the secret exactly once", async () => {
      const issued = await service.generate({
        organizationId: ORG,
        connectionId: CONNECTION,
        description: "Okta",
      });

      expect(issued.connectionId).toBe(CONNECTION);
      expect(store.tokens[0]).toMatchObject({
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      // Shown once: the plaintext is in this answer and nowhere else. What
      // is stored is a hash, and the listing surfaces neither.
      expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
      expect(store.tokens[0]?.hashedToken).not.toBe(issued.token);

      const listed = await service.list({ organizationId: ORG });
      expect(listed).toEqual([
        expect.objectContaining({ connectionId: CONNECTION }),
      ]);
      expect(JSON.stringify(listed)).not.toContain(issued.token);
      expect(JSON.stringify(listed)).not.toContain(
        store.tokens[0]?.hashedToken,
      );

      // And it reaches exactly the connection it names.
      await expect(
        service.verifyEntitled({ token: issued.token }),
      ).resolves.toMatchObject({
        status: "ok",
        organizationId: ORG,
        connectionId: CONNECTION,
      });
    });
  });

  describe("when one is issued without naming a connection", () => {
    /** @scenario "Issuing a token without naming a connection is refused" */
    it("refuses with scim_connection_required and writes nothing", async () => {
      const refusal = await service
        .generate({ organizationId: ORG })
        .catch((error: unknown) => error as { code: string });

      expect(refusal).toMatchObject({ code: "scim_connection_required" });
      // Nothing was minted, and no sync was started for a token that does
      // not exist.
      expect(store.tokens).toEqual([]);
      expect(SYNC_LIFECYCLE.tokenIssued).not.toHaveBeenCalled();
    });
  });

  describe("when a token predates connections entirely", () => {
    /** @scenario "Tokens issued before connections existed keep exactly the reach they had" */
    it("keeps working with the organization-wide reach it was sold with", async () => {
      // A row as it stood before connection scoping: an organization and no
      // connection, because there was none to name.
      store.tokens.push({
        id: "scimtok_legacy",
        organizationId: ORG,
        connectionId: null,
        hashedToken: hashOf("legacy-token"),
        // The bare digest is what the old scheme stored. This row is now also
        // the regression test for the lookup's legacy fallback: a token minted
        // before the pepper is still the credential its identity provider is
        // configured with, and must keep working.
        hashScheme: "sha256",
        description: "issued in 2025",
        createdAt: new Date(0),
        lastUsedAt: null,
      });

      const entitled = await service.verifyEntitled({ token: "legacy-token" });

      // It works as it always did, and nothing quietly attached it to a
      // connection on the way through — the answer is null, which is what
      // organization-wide reach looks like.
      expect(entitled).toEqual({
        status: "ok",
        organizationId: ORG,
        connectionId: null,
      });
      expect(store.tokens[0]?.connectionId).toBeNull();

      // Minting a new one alongside it does not backfill the old one either.
      await service.generate({ organizationId: ORG, connectionId: CONNECTION });
      expect(store.tokens[0]?.connectionId).toBeNull();
    });
  });

  describe("when the connection a token was issued against is removed", () => {
    /** @scenario "Removing a connection ends the tokens issued against it" */
    it("stops accepting it and refuses the next push rather than ignoring it", async () => {
      const doomed = await service.generate({
        organizationId: ORG,
        connectionId: CONNECTION,
      });
      const survivor = await service.generate({
        organizationId: ORG,
        connectionId: OTHER_CONNECTION,
      });

      const { revoked } = await service.revokeForConnection({
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(revoked).toBe(1);
      // The token stops being accepted — an unknown credential, which is
      // what the SCIM boundary turns into a refusal the directory can see,
      // rather than a call that succeeds and provisions nothing.
      await expect(
        service.verifyEntitled({ token: doomed.token }),
      ).resolves.toEqual({ status: "invalid_token" });
      // And the sync history says the connection's provisioning ended.
      expect(SYNC_LIFECYCLE.revoked).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG,
          connectionId: CONNECTION,
          cause: "teardown",
        }),
      );

      // Every other connection's tokens are untouched.
      await expect(
        service.verifyEntitled({ token: survivor.token }),
      ).resolves.toMatchObject({
        status: "ok",
        connectionId: OTHER_CONNECTION,
      });
    });
  });
});

/** The same hash the service stores, computed the same way — a test that
 *  invented its own would prove nothing about which rows a lookup reaches. */
function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
