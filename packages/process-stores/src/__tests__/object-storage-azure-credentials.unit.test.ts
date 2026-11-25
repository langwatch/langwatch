/**
 * @see specs/features/scenarios/azure-blob-workload-identity.feature
 */
import { describe, expect, it } from "vitest";

import type { ObjectStorageAzureConfig } from "../config.ts";
import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
} from "../object-storage-azure-credentials.ts";

const MARKER = "content-marker";
const injectedIdentity = {
  tenantId: "tenant-1",
  clientId: "client-1",
  federatedTokenFile: "/var/run/secrets/azure/tokens/azure-identity-token",
};

function sharedKeyConfig(overrides: Partial<ObjectStorageAzureConfig> = {}) {
  return {
    accountName: "lwacct",
    accountKey: MARKER,
    container: "lw-container",
    ...overrides,
  } satisfies ObjectStorageAzureConfig;
}

function tokenConfig(
  authMode: "workloadIdentity" | "managedIdentity" | "azureCli",
  overrides: Partial<ObjectStorageAzureConfig> = {},
) {
  return {
    authMode,
    accountName: "lwacct",
    container: "lw-container",
    ...(authMode === "workloadIdentity" ? { identity: injectedIdentity } : {}),
    ...overrides,
  } satisfies ObjectStorageAzureConfig;
}

function refusalOf(attempt: () => unknown): AzureBackendMisconfiguredError {
  try {
    attempt();
  } catch (error) {
    if (error instanceof AzureBackendMisconfiguredError) return error;
    throw error;
  }
  throw new Error("The configuration was accepted.");
}

describe("given AZURE_BLOB_AUTH_MODE is not set", () => {
  /** @scenario "Azure authentication defaults to shared key when no mode is set" */
  it("defaults to sharedKey and signs with the configured account key", () => {
    expect(resolveAzureCredentials(sharedKeyConfig())).toMatchObject({
      mode: "sharedKey",
      accountName: "lwacct",
      accountKey: MARKER,
      container: "lw-container",
    });
  });
});

describe("given each supported auth mode with its prerequisites satisfied", () => {
  /** @scenario "Each supported auth mode selects its own credential source" */
  it.each(["sharedKey", "workloadIdentity", "managedIdentity", "azureCli"] as const)(
    "resolves a distinct credential for %s, with an account key only for sharedKey",
    (mode) => {
      const config = mode === "sharedKey" ? sharedKeyConfig() : tokenConfig(mode);

      const credentials = resolveAzureCredentials(config);

      expect(credentials.mode).toBe(mode);
      expect(credentials.accountName).toBe("lwacct");
      expect("accountKey" in credentials).toBe(mode === "sharedKey");
    },
  );

  /** @scenario "Adding an auth mode forces every Azure credential construction site to be revisited" */
  it("refuses a mode no arm handles, by name, rather than falling through to a default", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(tokenConfig("azureCli", { authMode: "kerberos" })),
    );

    expect(refusal.message).toContain('Unsupported AZURE_BLOB_AUTH_MODE "kerberos"');
  });
});

describe("given Azure account credentials but no container configured", () => {
  /** @scenario "Writes still refuse without a container, naming it" */
  it("refuses a write, naming the container", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(sharedKeyConfig({ container: undefined })),
    );

    expect(refusal.missingVariables).toEqual(["AZURE_BLOB_CONTAINER"]);
  });
});

describe("given AZURE_BLOB_ACCOUNT_KEY is set alongside a token-based mode", () => {
  /** @scenario "A shared account key configured alongside a token-based mode is refused" */
  it("refuses, stating the key would be ignored and must be removed", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(tokenConfig("managedIdentity", { accountKey: MARKER })),
    );

    expect(refusal.message).toMatch(/AZURE_BLOB_ACCOUNT_KEY/);
    expect(refusal.message).toMatch(/remove/i);
  });
});

describe("given AZURE_BLOB_AUTH_MODE is a token-based mode but the backend is not azure", () => {
  /** @scenario "An auth mode configured while Azure is not the backend is refused" */
  it("refuses a write, stating the setting has no effect without the azure backend", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(tokenConfig("workloadIdentity"), { backend: "s3" }),
    );

    expect(refusal.message).toMatch(/STORED_OBJECTS_BACKEND=azure/);
  });

  /** @scenario "Historical Azure objects stay readable after moving writes to S3" */
  it("still resolves credentials for reads, so historical objects stay reachable", () => {
    const config = tokenConfig("workloadIdentity", { container: undefined });

    const credentials = resolveAzureCredentials(config, { purpose: "read", backend: "s3" });

    expect(credentials).toMatchObject({ mode: "workloadIdentity", accountName: "lwacct" });
    expect(() => resolveAzureCredentials(config, { backend: "s3" })).toThrow(
      AzureBackendMisconfiguredError,
    );
  });
});

describe("given AZURE_BLOB_AUTH_MODE=workloadIdentity with the platform-injected values absent", () => {
  /** @scenario "Missing federated identity input names the operator-actionable cause" */
  it("names the pod label, annotation and webhook, never telling the operator to set them by hand", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(tokenConfig("workloadIdentity", { identity: {} })),
    );

    expect(refusal.missingVariables).toEqual([
      "AZURE_CLIENT_ID",
      "AZURE_TENANT_ID",
      "AZURE_FEDERATED_TOKEN_FILE",
    ]);
    expect(refusal.message).toMatch(/azure\.workload\.identity\/use/);
    expect(refusal.message).toMatch(/azure\.workload\.identity\/client-id/);
    expect(refusal.message).toMatch(/webhook/i);
    expect(refusal.message).not.toMatch(/set (it|them|this) by hand/i);
  });
});

describe("given AZURE_BLOB_AUTH_MODE=sharedKey with AZURE_BLOB_ACCOUNT_KEY missing", () => {
  /** @scenario "Missing shared-key configuration still names the missing variable" */
  it("names AZURE_BLOB_ACCOUNT_KEY and that shared-key mode required it", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(sharedKeyConfig({ authMode: "sharedKey", accountKey: undefined })),
    );

    expect(refusal.missingVariables).toEqual(["AZURE_BLOB_ACCOUNT_KEY"]);
    expect(refusal.message).toMatch(/sharedKey/);
  });
});

describe("given a token-based mode with a plaintext AZURE_BLOB_ENDPOINT", () => {
  /** @scenario "A token-based mode refuses a non-HTTPS blob endpoint" */
  it("refuses, naming the endpoint variable and the transport requirement", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(
        tokenConfig("azureCli", { endpoint: "http://storage.example.com/lwacct" }),
      ),
    );

    expect(refusal.message).toMatch(/AZURE_BLOB_ENDPOINT/);
    expect(refusal.message).toMatch(/https/i);
  });

  it("accepts it when the test escape hatch is set", () => {
    const config = tokenConfig("azureCli", {
      endpoint: "http://127.0.0.1:10000/devstoreaccount1",
      allowInsecureTokenEndpointForTests: true,
    });

    expect(resolveAzureCredentials(config).mode).toBe("azureCli");
  });
});

describe("given a sovereign-cloud endpoint with no matching authority host configured", () => {
  const sovereign = "https://lwacct.blob.core.usgovcloudapi.net";

  /** @scenario "A sovereign-cloud endpoint without a matching authority is refused" */
  it("refuses, explaining a sovereign endpoint requires a matching authority host", () => {
    const refusal = refusalOf(() =>
      resolveAzureCredentials(tokenConfig("managedIdentity", { endpoint: sovereign })),
    );

    expect(refusal.message).toMatch(/AZURE_BLOB_AUTHORITY_HOST/);
  });

  it("carries the named authority rather than the public-cloud default", () => {
    const credentials = resolveAzureCredentials(
      tokenConfig("managedIdentity", {
        endpoint: sovereign,
        authorityHost: "https://login.microsoftonline.us",
      }),
    );

    expect(credentials).toMatchObject({ authorityHost: "https://login.microsoftonline.us" });
  });
});
