/**
 * Unit tests for the Azure Blob token cache + acquisition module
 * (issue #6087). `@azure/identity` is mocked so tests control exactly when
 * an exchange resolves, rejects, and what it returns — the real SDK network
 * calls are exercised only by the (out of scope here) integration suites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  workloadGetToken,
  managedGetToken,
  cliGetToken,
  workloadCtorCalls,
  managedCtorCalls,
} = vi.hoisted(() => ({
  workloadGetToken: vi.fn(),
  managedGetToken: vi.fn(),
  cliGetToken: vi.fn(),
  workloadCtorCalls: [] as unknown[],
  managedCtorCalls: [] as unknown[],
}));

// Classes, not arrow functions: the module under test calls `new
// WorkloadIdentityCredential(...)`, and an arrow function is not a
// constructor — mocking with one throws "is not a constructor" before the
// code under test is ever reached.
vi.mock("@azure/identity", () => ({
  WorkloadIdentityCredential: class {
    getToken = workloadGetToken;
    constructor(options: unknown) {
      workloadCtorCalls.push(options);
    }
  },
  ManagedIdentityCredential: class {
    getToken = managedGetToken;
    constructor(options: unknown) {
      managedCtorCalls.push(options);
    }
  },
  AzureCliCredential: class {
    getToken = cliGetToken;
  },
}));

import type { TokenModeCredentials } from "../azure-token-provider";
import {
  AzureTokenExchangeError,
  getAzureBlobToken,
  invalidateAzureBlobToken,
  resetAzureTokenCacheForTests,
} from "../azure-token-provider";

const ONE_HOUR_MS = 60 * 60 * 1000;

function futureToken(token: string, msFromNow = ONE_HOUR_MS) {
  return { token, expiresOnTimestamp: Date.now() + msFromNow };
}

const workloadIdentityCredentials: TokenModeCredentials = {
  mode: "workloadIdentity",
  accountName: "lwacct",
};

beforeEach(() => {
  resetAzureTokenCacheForTests();
  workloadGetToken.mockReset();
  managedGetToken.mockReset();
  cliGetToken.mockReset();
  workloadCtorCalls.length = 0;
  managedCtorCalls.length = 0;
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_FEDERATED_TOKEN_FILE;
});

afterEach(() => {
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_FEDERATED_TOKEN_FILE;
});

describe("getAzureBlobToken", () => {
  describe("given a token has already been acquired and is still valid", () => {
    /** @scenario "An access token is reused across operations rather than re-fetched per call" */
    it("contacts the identity provider once, not once per operation", async () => {
      workloadGetToken.mockResolvedValue(futureToken("token-a"));

      const first = await getAzureBlobToken(workloadIdentityCredentials);
      const second = await getAzureBlobToken(workloadIdentityCredentials);
      const third = await getAzureBlobToken(workloadIdentityCredentials);

      expect(first).toBe("token-a");
      expect(second).toBe("token-a");
      expect(third).toBe("token-a");
      expect(workloadGetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a storage endpoint in a sovereign cloud with a configured authority host and audience", () => {
    /** @scenario "A sovereign-cloud storage endpoint obtains tokens from the matching authority" */
    it("requests the token from the configured authority, scoped to the configured audience", async () => {
      workloadGetToken.mockResolvedValue(futureToken("sovereign-token"));
      const sovereignCredentials: TokenModeCredentials = {
        mode: "workloadIdentity",
        accountName: "lwacct",
        authorityHost: "https://login.microsoftonline.us",
        audience: "https://storage.azure.us",
      };

      // The real WorkloadIdentityCredential throws CredentialUnavailableError
      // without tenantId/clientId; our mock accepts any options object, so the
      // constructor wiring is exactly what this suite cannot catch unless it
      // asserts on it. Dropping those two lines from buildCredential() would
      // otherwise leave every test here green while breaking every real
      // workload-identity exchange in production.
      process.env.AZURE_TENANT_ID = "tenant-id-from-webhook";
      process.env.AZURE_CLIENT_ID = "client-id-from-webhook";

      const token = await getAzureBlobToken(sovereignCredentials);

      expect(token).toBe("sovereign-token");
      expect(workloadCtorCalls).toHaveLength(1);
      expect(workloadCtorCalls[0]).toMatchObject({
        authorityHost: "https://login.microsoftonline.us",
        tenantId: "tenant-id-from-webhook",
        clientId: "client-id-from-webhook",
      });
      expect(workloadGetToken).toHaveBeenCalledWith(
        "https://storage.azure.us/.default",
      );
    });

    it("scopes to the public-cloud audience when no audience is configured, not the sovereign endpoint's default", async () => {
      workloadGetToken.mockResolvedValue(futureToken("public-audience-token"));
      const credentialsWithOnlyAuthority: TokenModeCredentials = {
        mode: "workloadIdentity",
        accountName: "lwacct",
        authorityHost: "https://login.microsoftonline.us",
      };

      await getAzureBlobToken(credentialsWithOnlyAuthority);

      expect(workloadGetToken).toHaveBeenCalledWith(
        "https://storage.azure.com/.default",
      );
    });
  });

  describe("given two projects resolve to the same Azure identity and audience", () => {
    /** @scenario "Projects sharing an identity share a cached token" */
    it("reuses the same cached token across separately-constructed driver instances", async () => {
      process.env.AZURE_TENANT_ID = "tenant-shared";
      process.env.AZURE_CLIENT_ID = "client-shared";
      workloadGetToken.mockResolvedValue(futureToken("shared-token"));

      // Two "different driver instances" translate to two independent calls
      // with equal (but not identical object-identity) credential values —
      // exactly what two AzureBlobDriver instances built from the same
      // resolveAzureCredentials() output would pass.
      const credentialsA: TokenModeCredentials = {
        mode: "workloadIdentity",
        accountName: "lwacct",
      };
      const credentialsB: TokenModeCredentials = {
        mode: "workloadIdentity",
        accountName: "lwacct",
      };

      const tokenA = await getAzureBlobToken(credentialsA);
      const tokenB = await getAzureBlobToken(credentialsB);

      expect(tokenA).toBe("shared-token");
      expect(tokenB).toBe("shared-token");
      expect(workloadGetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("given two projects resolve to different Azure identities", () => {
    /** @scenario "Projects resolving to different identities never share a token" */
    it("acquires and uses a separate token for each — one identity's token is never presented to the other", async () => {
      workloadGetToken
        .mockResolvedValueOnce(futureToken("token-identity-a"))
        .mockResolvedValueOnce(futureToken("token-identity-b"));

      process.env.AZURE_TENANT_ID = "tenant-a";
      process.env.AZURE_CLIENT_ID = "client-a";
      const tokenA = await getAzureBlobToken(workloadIdentityCredentials);

      process.env.AZURE_TENANT_ID = "tenant-b";
      process.env.AZURE_CLIENT_ID = "client-b";
      const tokenB = await getAzureBlobToken(workloadIdentityCredentials);

      expect(tokenA).toBe("token-identity-a");
      expect(tokenB).toBe("token-identity-b");
      expect(tokenA).not.toBe(tokenB);
      expect(workloadGetToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("given many storage operations begin simultaneously with an empty token cache", () => {
    /** @scenario "Concurrent cold-start operations trigger a single token exchange" */
    it("performs exactly one token exchange and every caller proceeds with the resulting token", async () => {
      let resolveExchange!: (value: {
        token: string;
        expiresOnTimestamp: number;
      }) => void;
      workloadGetToken.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExchange = resolve;
          }),
      );

      const calls = Promise.all([
        getAzureBlobToken(workloadIdentityCredentials),
        getAzureBlobToken(workloadIdentityCredentials),
        getAzureBlobToken(workloadIdentityCredentials),
        getAzureBlobToken(workloadIdentityCredentials),
      ]);

      // Let all four calls reach their synchronous cache check before the
      // single in-flight exchange resolves.
      await Promise.resolve();
      await Promise.resolve();
      resolveExchange(futureToken("cold-start-token"));

      const results = await calls;

      expect(results).toEqual([
        "cold-start-token",
        "cold-start-token",
        "cold-start-token",
        "cold-start-token",
      ]);
      expect(workloadGetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the cached token expires within the refresh safety margin", () => {
    /** @scenario "An access token is refreshed before it expires rather than after a failure" */
    it("acquires a fresh token before the next request is issued", async () => {
      // 1 minute out — inside the 5-minute safety margin.
      workloadGetToken
        .mockResolvedValueOnce(futureToken("about-to-expire", 60 * 1000))
        .mockResolvedValueOnce(futureToken("refreshed-token"));

      const stale = await getAzureBlobToken(workloadIdentityCredentials);
      const fresh = await getAzureBlobToken(workloadIdentityCredentials);

      expect(stale).toBe("about-to-expire");
      expect(fresh).toBe("refreshed-token");
      expect(workloadGetToken).toHaveBeenCalledTimes(2);
    });
  });

  describe("given workloadIdentity mode and the projected token has rotated on disk", () => {
    /** @scenario "The federated assertion is re-read for every token exchange" */
    it("passes the CURRENT AZURE_FEDERATED_TOKEN_FILE path fresh on every exchange rather than caching content itself", async () => {
      process.env.AZURE_FEDERATED_TOKEN_FILE =
        "/var/run/secrets/tokens/original";
      workloadGetToken.mockResolvedValueOnce(futureToken("token-1", 60 * 1000));

      await getAzureBlobToken(workloadIdentityCredentials);

      // Simulate rotation: kubelet replaces the projected file at the same
      // path, but for a long-running worker the env var itself could also
      // be re-pointed across a pod restart. Change it and force a refresh
      // (the token above is within the safety margin already).
      process.env.AZURE_FEDERATED_TOKEN_FILE =
        "/var/run/secrets/tokens/rotated";
      workloadGetToken.mockResolvedValueOnce(futureToken("token-2"));

      await getAzureBlobToken(workloadIdentityCredentials);

      expect(workloadCtorCalls).toHaveLength(2);
      expect(workloadCtorCalls[0]).toMatchObject({
        tokenFilePath: "/var/run/secrets/tokens/original",
      });
      expect(workloadCtorCalls[1]).toMatchObject({
        tokenFilePath: "/var/run/secrets/tokens/rotated",
      });
    });
  });

  describe("given the identity provider rejects the credential exchange", () => {
    /** @scenario "A failed token exchange surfaces as a configuration error, not a storage error" */
    it("identifies the token exchange as the failure and leaks no credential material", async () => {
      class FakeSdkError extends Error {
        constructor() {
          super(
            "CredentialUnavailableError: assertion eyJhbGciOiJSUzI1NiIs... rejected",
          );
          this.name = "CredentialUnavailableError";
        }
      }
      workloadGetToken.mockRejectedValue(new FakeSdkError());

      await expect(
        getAzureBlobToken(workloadIdentityCredentials),
      ).rejects.toBeInstanceOf(AzureTokenExchangeError);

      let thrown: unknown;
      try {
        await getAzureBlobToken(workloadIdentityCredentials);
      } catch (error) {
        thrown = error;
      }
      const message = (thrown as Error).message;
      expect(message).toMatch(/token exchange/i);
      expect(message).not.toMatch(/eyJhbGciOiJSUzI1NiIs/);
    });

    it("clears the cache entry so the next call retries instead of replaying the rejection", async () => {
      workloadGetToken
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce(futureToken("recovered-token"));

      await expect(
        getAzureBlobToken(workloadIdentityCredentials),
      ).rejects.toBeInstanceOf(AzureTokenExchangeError);

      const recovered = await getAzureBlobToken(workloadIdentityCredentials);
      expect(recovered).toBe("recovered-token");
      expect(workloadGetToken).toHaveBeenCalledTimes(2);
    });

    /**
     * AADSTS70021 is the most common workload-identity misconfiguration:
     * the federated credential's issuer/subject/audience does not match the
     * token the cluster presented. The code is an identifier, not credential
     * material, and without it an operator is left guessing.
     */
    /** @scenario "A failed token exchange surfaces as a configuration error, not a storage error" */
    it("surfaces the AADSTS code and the federated-credential remedy, without the SDK message", async () => {
      workloadGetToken.mockRejectedValueOnce(
        new Error(
          "AADSTS70021: No matching federated identity record found for " +
            "presented assertion. Assertion: eyJhbGciOiJSUzI1NiJ9.secret.sig",
        ),
      );

      const error = await getAzureBlobToken(workloadIdentityCredentials).then(
        () => null,
        (e: unknown) => e as Error & { aadstsCode?: string },
      );

      expect(error?.aadstsCode).toBe("AADSTS70021");
      expect(error?.message).toContain("AADSTS70021");
      expect(error?.message).toMatch(/system:serviceaccount/);
      expect(error?.message).toMatch(/api:\/\/AzureADTokenExchange/);
      // The assertion the SDK quoted must not ride along.
      expect(error?.message).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    });

    /**
     * @azure/identity ships @azure/core-rest-pipeline, whose retry policy
     * already honours the provider's Retry-After. A retry loop here would
     * nest inside that one and multiply attempts against an endpoint that
     * just asked us to slow down.
     */
    /** @scenario "Throttle backoff is delegated to the identity library, not duplicated" */
    it("surfaces a throttled exchange without retrying on top of the library", async () => {
      const throttled = Object.assign(new Error("Too many requests"), {
        statusCode: 429,
      });
      workloadGetToken.mockRejectedValueOnce(throttled);

      await expect(
        getAzureBlobToken(workloadIdentityCredentials),
      ).rejects.toBeInstanceOf(AzureTokenExchangeError);

      // Exactly one attempt: the library owns backoff, we own not compounding it.
      expect(workloadGetToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalidateAzureBlobToken", () => {
    it("evicts the cached token so the next call re-exchanges", async () => {
      workloadGetToken
        .mockResolvedValueOnce(futureToken("token-before"))
        .mockResolvedValueOnce(futureToken("token-after"));

      const before = await getAzureBlobToken(workloadIdentityCredentials);
      invalidateAzureBlobToken(workloadIdentityCredentials);
      const after = await getAzureBlobToken(workloadIdentityCredentials);

      expect(before).toBe("token-before");
      expect(after).toBe("token-after");
      expect(workloadGetToken).toHaveBeenCalledTimes(2);
    });
  });
});
