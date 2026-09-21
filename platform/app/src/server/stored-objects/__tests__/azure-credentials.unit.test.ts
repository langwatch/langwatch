/**
 * Unit tests for `resolveAzureCredentials` — the single source of truth for
 * Azure Blob credentials across every auth mode (issue #6087).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock("~/env.mjs", () => ({
  env: mockEnv,
}));

import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
} from "../azure-credentials";

const ALLOW_INSECURE_ENV = "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS";

function resetEnv() {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
}

function setSharedKeyEnv() {
  mockEnv.STORED_OBJECTS_BACKEND = "azure";
  mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
  mockEnv.AZURE_BLOB_ACCOUNT_KEY = "key-value";
  mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
}

function setTokenModeEnv(mode: string) {
  mockEnv.STORED_OBJECTS_BACKEND = "azure";
  mockEnv.AZURE_BLOB_AUTH_MODE = mode;
  mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
  mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
}

const injectedWorkloadIdentityVars = {
  AZURE_CLIENT_ID: "client-id",
  AZURE_TENANT_ID: "tenant-id",
  AZURE_FEDERATED_TOKEN_FILE:
    "/var/run/secrets/azure/tokens/azure-identity-token",
};

beforeEach(() => {
  resetEnv();
});

afterEach(() => {
  delete process.env[ALLOW_INSECURE_ENV];
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_FEDERATED_TOKEN_FILE;
});

describe("resolveAzureCredentials", () => {
  describe("given AZURE_BLOB_AUTH_MODE is not set", () => {
    /** @scenario "Azure authentication defaults to shared key when no mode is set" */
    it("defaults to sharedKey and signs with the configured account key", () => {
      setSharedKeyEnv();

      const credentials = resolveAzureCredentials();

      expect(credentials).toEqual({
        mode: "sharedKey",
        accountName: "lwacct",
        accountKey: "key-value",
        endpointBaseUrl: undefined,
      });
    });
  });

  describe("given each supported auth mode with its prerequisites satisfied", () => {
    /** @scenario "Each supported auth mode selects its own credential source" */
    it.each([
      ["sharedKey" as const],
      ["workloadIdentity" as const],
      ["managedIdentity" as const],
      ["azureCli" as const],
    ])("resolves a distinct credential for %s without requiring an account key unless sharedKey", (mode) => {
      if (mode === "sharedKey") {
        setSharedKeyEnv();
      } else {
        setTokenModeEnv(mode);
        if (mode === "workloadIdentity") {
          Object.assign(process.env, injectedWorkloadIdentityVars);
        }
      }

      const credentials = resolveAzureCredentials();

      expect(credentials.mode).toBe(mode);
      expect(credentials.accountName).toBe("lwacct");
      if (mode === "sharedKey") {
        expect((credentials as { accountKey: string }).accountKey).toBe(
          "key-value",
        );
      } else {
        expect("accountKey" in credentials).toBe(false);
      }
    });

    /** @scenario "Adding an auth mode forces every Azure credential construction site to be revisited" */
    it("exhaustively handles every AZURE_BLOB_AUTH_MODE value — a switch, not a default fallthrough", () => {
      // The implementation's mode switch ends every non-sharedKey arm with a
      // `const unreachable: never = mode` exhaustiveness check — a fifth
      // auth-mode value added to azureBlobAuthModeSchema without a matching
      // arm here fails to COMPILE, not just fails a runtime assertion. This
      // test pins the runtime half of that contract: every currently
      // supported mode is actually reachable and returns its own
      // discriminated credential shape, proving there is no silent
      // default-case swallow.
      const modes = [
        "sharedKey",
        "workloadIdentity",
        "managedIdentity",
        "azureCli",
      ] as const;

      for (const mode of modes) {
        resetEnv();
        if (mode === "sharedKey") {
          setSharedKeyEnv();
        } else {
          setTokenModeEnv(mode);
          if (mode === "workloadIdentity") {
            Object.assign(process.env, injectedWorkloadIdentityVars);
          }
        }
        expect(resolveAzureCredentials().mode).toBe(mode);
      }
    });
  });

  describe("given AZURE_BLOB_ACCOUNT_KEY is set alongside a token-based mode", () => {
    /** @scenario "A shared account key configured alongside a token-based mode is refused" */
    it("refuses, stating the key would be ignored and must be removed", () => {
      setTokenModeEnv("managedIdentity");
      mockEnv.AZURE_BLOB_ACCOUNT_KEY = "leftover-key";

      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials()).toThrow(/AZURE_BLOB_ACCOUNT_KEY/);
      expect(() => resolveAzureCredentials()).toThrow(/remove/i);
    });
  });

  describe("given AZURE_BLOB_AUTH_MODE is a token-based mode but the backend is not azure", () => {
    /** @scenario "An auth mode configured while Azure is not the backend is refused" */
    it("refuses, stating the setting has no effect without the azure backend", () => {
      mockEnv.STORED_OBJECTS_BACKEND = "s3";
      mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";

      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials()).toThrow(
        /STORED_OBJECTS_BACKEND=azure/,
      );
    });

    /**
     * The read exemption is the whole reason an Azure->S3 migration keeps its
     * history: `maybeAzureDriver` resolves with `purpose: "read"`, and if that
     * threw here it would register no driver and strand every object ever
     * written to azure-blob://. Nothing else in the repo exercised this, so
     * deleting the `purpose === "write" &&` clause left every test green.
     */
    /** @scenario "Historical Azure objects stay readable after moving writes to S3" */
    it("still resolves credentials for reads, so historical objects stay reachable", () => {
      mockEnv.STORED_OBJECTS_BACKEND = "s3";
      mockEnv.AZURE_BLOB_AUTH_MODE = "workloadIdentity";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "acct";
      mockEnv.AZURE_BLOB_CONTAINER = "cont";
      process.env.AZURE_CLIENT_ID = "client-id";
      process.env.AZURE_TENANT_ID = "tenant-id";
      process.env.AZURE_FEDERATED_TOKEN_FILE =
        "/var/run/secrets/azure/tokens/azure-identity-token";

      const credentials = resolveAzureCredentials({ purpose: "read" });

      expect(credentials.mode).toBe("workloadIdentity");
      expect(credentials.accountName).toBe("acct");
      // ...while the default (write) resolution still refuses the same config.
      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
    });
  });

  describe("given AZURE_BLOB_AUTH_MODE=workloadIdentity with the platform-injected values absent", () => {
    /** @scenario "Missing federated identity input names the operator-actionable cause" */
    it("raises a configuration error naming the pod label, annotation, or webhook — never 'set this by hand'", () => {
      setTokenModeEnv("workloadIdentity");
      // Deliberately NOT setting AZURE_CLIENT_ID / AZURE_TENANT_ID /
      // AZURE_FEDERATED_TOKEN_FILE — the webhook never mutated this pod.

      let thrown: unknown;
      try {
        resolveAzureCredentials();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AzureBackendMisconfiguredError);
      const message = (thrown as Error).message;
      expect(message).toMatch(/azure\.workload\.identity\/use/);
      expect(message).toMatch(/azure\.workload\.identity\/client-id/);
      expect(message).toMatch(/webhook/i);
      expect(message).not.toMatch(/set (it|them|this) by hand/i);
    });
  });

  describe("given AZURE_BLOB_AUTH_MODE=sharedKey with AZURE_BLOB_ACCOUNT_KEY missing", () => {
    /** @scenario "Missing shared-key configuration still names the missing variable" */
    it("raises a configuration error naming AZURE_BLOB_ACCOUNT_KEY and that shared-key mode required it", () => {
      mockEnv.STORED_OBJECTS_BACKEND = "azure";
      mockEnv.AZURE_BLOB_AUTH_MODE = "sharedKey";
      mockEnv.AZURE_BLOB_ACCOUNT_NAME = "lwacct";
      mockEnv.AZURE_BLOB_CONTAINER = "lw-container";
      // AZURE_BLOB_ACCOUNT_KEY intentionally left unset.

      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials()).toThrow(/AZURE_BLOB_ACCOUNT_KEY/);
      expect(() => resolveAzureCredentials()).toThrow(/sharedKey/);
    });
  });

  describe("given a token-based mode with a plaintext AZURE_BLOB_ENDPOINT", () => {
    /** @scenario "A token-based mode refuses a non-HTTPS blob endpoint" */
    it("fails, naming the endpoint variable and the transport requirement", () => {
      setTokenModeEnv("azureCli");
      mockEnv.AZURE_BLOB_ENDPOINT = "http://storage.example.com/lwacct";

      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials()).toThrow(/AZURE_BLOB_ENDPOINT/);
      expect(() => resolveAzureCredentials()).toThrow(/https/i);
    });

    it("succeeds when the test escape hatch env var is set", () => {
      setTokenModeEnv("azureCli");
      mockEnv.AZURE_BLOB_ENDPOINT = "http://127.0.0.1:10000/devstoreaccount1";
      process.env[ALLOW_INSECURE_ENV] = "1";

      expect(() => resolveAzureCredentials()).not.toThrow();
    });
  });

  describe("given a sovereign-cloud endpoint with no matching authority host configured", () => {
    /** @scenario "A sovereign-cloud endpoint without a matching authority is refused" */
    it("fails, explaining a sovereign endpoint requires a matching authority host", () => {
      setTokenModeEnv("managedIdentity");
      mockEnv.AZURE_BLOB_ENDPOINT =
        "https://lwacct.blob.core.usgovcloudapi.net";
      // AZURE_BLOB_AUTHORITY_HOST intentionally left unset.

      expect(() => resolveAzureCredentials()).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials()).toThrow(
        /AZURE_BLOB_AUTHORITY_HOST/,
      );
    });

    it("does not silently fall back to the public-cloud authority", () => {
      setTokenModeEnv("managedIdentity");
      mockEnv.AZURE_BLOB_ENDPOINT =
        "https://lwacct.blob.core.usgovcloudapi.net";
      mockEnv.AZURE_BLOB_AUTHORITY_HOST = "https://login.microsoftonline.us";

      const credentials = resolveAzureCredentials();

      expect(credentials.mode).toBe("managedIdentity");
      expect((credentials as { authorityHost?: string }).authorityHost).toBe(
        "https://login.microsoftonline.us",
      );
    });
  });
});
