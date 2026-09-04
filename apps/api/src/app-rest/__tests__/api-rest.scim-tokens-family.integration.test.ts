/**
 * The SCIM tokens management family and the SCIM protocol family, mounted
 * together over ONE directory application.
 *
 * Together is the point. A SCIM token is the credential an identity provider
 * will hold, so what has to be pinned is not that three routes answer but that
 * the value the mint returns is the value the protocol door accepts, that it
 * appears nowhere else afterwards, and that a revoke takes it out of both
 * doors at once. Mounting the management family on its own would prove none of
 * that.
 *
 * The store below is in memory rather than Postgres, and it stores a DIGEST:
 * the assertions are about what crosses the wire in each direction, which is
 * the transport's own contract, and a store that kept plaintext would let the
 * "never returns secrets" assertion pass for the wrong reason.
 *
 * @see specs/organizations/scim-tokens-rest-api.feature
 */
import { createHash, randomUUID } from "node:crypto";

import { ScimApp, type ScimService } from "@langwatch/enterprise-api";
import { NotFoundError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountRestFamily, TEST_ORGANIZATION_ID } from "./support/rest-family.harness";

const CONNECTION_ID = "ssoconn_acme";

describe("given the organization's SCIM tokens over REST", () => {
  describe("when a token is minted and the organization's tokens are listed", () => {
    // @scenario "Listing SCIM tokens never returns secrets"
    it("describes the token without ever carrying its value or its digest", async () => {
      const api = mountScimFamilies();

      const create = await api.post("/api/v1/scim-tokens", {
        connectionId: CONNECTION_ID,
        description: "List secrets",
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as { id: string; token: string };

      const list = await api.get("/api/v1/scim-tokens");

      expect(list.status).toBe(200);
      const body = (await list.json()) as { tokens: Array<Record<string, unknown>> };
      expect(body.tokens).toContainEqual(
        expect.objectContaining({
          id: created.id,
          description: "List secrets",
          connectionId: CONNECTION_ID,
        }),
      );
      expect(body.tokens[0]).toHaveProperty("createdAt");
      expect(body.tokens[0]).toHaveProperty("lastUsedAt");

      const raw = JSON.stringify(body);
      expect(raw).not.toContain(created.token);
      expect(raw).not.toContain(digest(created.token));
    });
  });

  describe("when a token is minted", () => {
    // @scenario "Creating a SCIM token returns the secret exactly once"
    it("returns the value once, and that value authenticates a SCIM request", async () => {
      const api = mountScimFamilies();

      const create = await api.post("/api/v1/scim-tokens", {
        connectionId: CONNECTION_ID,
        description: "Okta production",
      });

      expect(create.status).toBe(201);
      const created = (await create.json()) as { token: string; description: string };
      expect(created.token).toBeTruthy();
      expect(created.description).toBe("Okta production");

      const provisioning = await api.get("/api/scim/v2/Users", {
        authorization: `Bearer ${created.token}`,
      });
      expect(provisioning.status).toBe(200);

      const list = await api.get("/api/v1/scim-tokens");
      expect(JSON.stringify(await list.json())).not.toContain(created.token);
    });
  });

  describe("when a minted token is revoked", () => {
    // @scenario "Revoking a SCIM token stops it verifying"
    it("refuses provisioning with it, and answers a second revoke with scim_token_not_found", async () => {
      const api = mountScimFamilies();
      const created = (await (
        await api.post("/api/v1/scim-tokens", { connectionId: CONNECTION_ID })
      ).json()) as { id: string; token: string };
      const bearer = { authorization: `Bearer ${created.token}` };

      expect((await api.get("/api/scim/v2/Users", bearer)).status).toBe(200);

      const revoke = await api.delete(`/api/v1/scim-tokens/${created.id}`);

      expect(revoke.status).toBe(200);
      await expect(revoke.json()).resolves.toEqual({ success: true });
      expect((await api.get("/api/scim/v2/Users", bearer)).status).toBe(401);

      const again = await api.delete(`/api/v1/scim-tokens/${created.id}`);
      expect(again.status).toBe(404);
      await expect(errorCodeOf(again)).resolves.toBe("scim_token_not_found");
    });
  });
});

describe("given both SCIM families this process mounts", () => {
  describe("when the management family is addressed without its version segment", () => {
    it("answers the bare alias identically to the dated path", async () => {
      const api = mountScimFamilies();
      await api.post("/api/v1/scim-tokens", { connectionId: CONNECTION_ID });

      const dated = await api.get("/api/v1/scim-tokens");
      const bare = await api.get("/api/scim-tokens");

      expect(bare.status).toBe(dated.status);
      await expect(bare.json()).resolves.toEqual(await dated.json());
    });
  });
});

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** The revoke refusal, in the code the family publishes for it. */
class TokenNotFound extends NotFoundError {
  constructor(tokenId: string) {
    super("scim_token_not_found", "SCIM token", tokenId, { meta: { tokenId } });
  }
}

/**
 * One directory application behind both doors, keeping only digests.
 *
 * Everything outside the token lifecycle is a NAMED absence: an operation this
 * suite does not compose fails saying so rather than answering emptily.
 */
function inMemoryScim(): ScimService {
  const tokens = new Map<
    string,
    { id: string; hashed: string; connectionId: string | null; description: string | null }
  >();

  const implemented = {
    generateToken: async (input: { connectionId?: string | null; description?: string }) => {
      const token = `scim_${randomUUID()}`;
      const tokenId = `scimtoken_${tokens.size + 1}`;
      tokens.set(tokenId, {
        id: tokenId,
        hashed: digest(token),
        connectionId: input.connectionId ?? null,
        description: input.description ?? null,
      });
      return { token, tokenId, connectionId: input.connectionId ?? CONNECTION_ID };
    },
    listTokens: async () =>
      [...tokens.values()].map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        description: row.description,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        lastUsedAt: null,
      })),
    revokeToken: async (input: { tokenId: string }) => {
      if (!tokens.delete(input.tokenId)) throw new TokenNotFound(input.tokenId);
      return { success: true as const };
    },
    verifyToken: async (input: { token: string }) => {
      const hashed = digest(input.token);
      const found = [...tokens.values()].find((row) => row.hashed === hashed);
      if (!found) return { status: "invalid_token" as const };
      return {
        status: "ok" as const,
        organizationId: TEST_ORGANIZATION_ID,
        connectionId: found.connectionId,
      };
    },
    listUsers: async () => ({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 100,
      Resources: [],
    }),
  };

  return new Proxy(implemented, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return value;
      return () => {
        throw new Error(`This suite composes no SCIM ${String(property)}`);
      };
    },
  }) as never;
}

function mountScimFamilies() {
  const scim = inMemoryScim();
  return mountRestFamily({
    packaged: { scim: () => ScimApp.create({ scim }) },
    processPorts: {
      scim: {
        scim: () => scim,
        webhookSecret: undefined,
      },
    },
  });
}
