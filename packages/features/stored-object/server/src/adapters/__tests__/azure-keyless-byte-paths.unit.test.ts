/**
 * @vitest-environment node
 *
 * Issue #6087 — the byte paths that must keep working when Azure is
 * configured with an identity instead of an account key.
 *
 * The failure these guard against is a WIRING bug rather than a signing one,
 * and it is invisible to the driver's own tests: a keyless install used to
 * resolve Azure as the write destination and then refuse every PUT as an
 * unregistered scheme. Destination resolution and driver registration now
 * read the same `resolveAzureCredentials`, so both answers move together.
 *
 * `@azure/identity` is mocked: what is under test is which credentials each
 * byte path ends up holding, not the exchange itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("@azure/identity", () => ({
  WorkloadIdentityCredential: class {
    getToken = getToken;
  },
  ManagedIdentityCredential: class {
    getToken = getToken;
  },
  AzureCliCredential: class {
    getToken = getToken;
  },
}));

import { AzureBlobStoredObjectDriver } from "../azure-blob.stored-object-driver.adapter";
import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
  type AzureBlobCredentialsConfig,
  type AzureInjectedIdentity,
} from "../azure-blob-credentials";
import { resetAzureTokenCacheForTests } from "../azure-blob-token-provider";
import {
  StoredObjectAzureDestinationPort,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
} from "../stored-object-destination.policy";
import { StoredObjectStorageRegistry } from "../stored-object-storage.registry";

const PROJECT_ID = "proj-1";
const HISTORICAL_URI = `azure-blob://lwacct/written-long-ago/${PROJECT_ID}/abc123`;

/** A keyless install: identity mode, and no account key anywhere. */
const KEYLESS_CONFIG: AzureBlobCredentialsConfig = {
  authMode: "workloadIdentity",
  accountName: "lwacct",
  accountKey: undefined,
  container: "stored-objects",
  endpoint: undefined,
  authorityHost: undefined,
  tokenAudience: undefined,
  backend: "azure",
  allowInsecureTokenEndpointForTests: false,
};

/** What the AKS workload-identity webhook writes into the pod. */
const INJECTED_IDENTITY: AzureInjectedIdentity = {
  tenantId: "tenant-id",
  clientId: "client-id",
  federatedTokenFile: "/var/run/secrets/azure/tokens/azure-identity-token",
};

/** Account credentials retained for reads after writes moved off Azure. */
const READ_ONLY_CONFIG: AzureBlobCredentialsConfig = {
  authMode: "sharedKey",
  accountName: "lwacct",
  accountKey: "a2V5",
  container: undefined,
  endpoint: undefined,
  authorityHost: undefined,
  tokenAudience: undefined,
  backend: "s3",
  allowInsecureTokenEndpointForTests: false,
};

class NoPrivateBucket extends StoredObjectProjectS3ConfigPort {
  async tryGet(): Promise<null> {
    return null;
  }
}

/** The destination port a composition root wires from the shared resolver. */
class ResolvedAzureDestination extends StoredObjectAzureDestinationPort {
  constructor(
    private readonly config: AzureBlobCredentialsConfig,
    private readonly identity: AzureInjectedIdentity,
  ) {
    super();
  }
  resolve() {
    const credentials = resolveAzureCredentials({
      config: this.config,
      purpose: "write",
      identity: this.identity,
    });
    return { accountName: credentials.accountName, container: this.config.container! };
  }
}

function policyFor(
  config: AzureBlobCredentialsConfig,
  identity: AzureInjectedIdentity,
): StoredObjectDestinationPolicy {
  return StoredObjectDestinationPolicy.create({
    selection: {
      backend: "azure",
      localFilesystemRoot: "/var/lib/langwatch/objects",
      azure: new ResolvedAzureDestination(config, identity),
    },
    projects: new NoPrivateBucket(),
  });
}

const dispatchedElsewhere = {
  get: async () => {
    throw new Error("dispatched to the wrong scheme");
  },
  put: async () => {
    throw new Error("dispatched to the wrong scheme");
  },
  delete: async () => {
    throw new Error("dispatched to the wrong scheme");
  },
  exists: async () => {
    throw new Error("dispatched to the wrong scheme");
  },
};

/**
 * The registry a composition root builds: the Azure arm is a FACTORY over the
 * same configuration, resolved for reads so an install that stopped writing to
 * Azure keeps serving what it already wrote.
 */
function registryFor(
  config: AzureBlobCredentialsConfig,
  identity: AzureInjectedIdentity = {},
): StoredObjectStorageRegistry {
  return new StoredObjectStorageRegistry({
    s3: dispatchedElsewhere,
    file: dispatchedElsewhere,
    "azure-blob": () =>
      AzureBlobStoredObjectDriver.create(
        resolveAzureCredentials({ config, purpose: "read", identity }),
      ),
  });
}

beforeEach(() => {
  resetAzureTokenCacheForTests();
  getToken.mockReset();
  getToken.mockResolvedValue({
    token: "bearer-token",
    expiresOnTimestamp: Date.now() + 60 * 60 * 1000,
  });
});

describe("Azure byte paths without an account key", () => {
  describe("given the backend is azure in workload-identity mode", () => {
    /** @scenario "A token-mode write path resolves without consulting a shared key" */
    it("resolves an azure write destination while no account key is configured", async () => {
      await expect(
        policyFor(KEYLESS_CONFIG, INJECTED_IDENTITY).resolve(PROJECT_ID),
      ).resolves.toEqual({
        kind: "azure",
        accountName: "lwacct",
        container: "stored-objects",
      });
      expect(KEYLESS_CONFIG.accountKey).toBeUndefined();
    });

    /** @scenario "A token-mode write path resolves without consulting a shared key" */
    it("dispatches an azure-blob write through a registered driver rather than an unconfigured scheme", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 201 }));
      try {
        await registryFor(KEYLESS_CONFIG, INJECTED_IDENTITY).put(
          `azure-blob://lwacct/stored-objects/${PROJECT_ID}/abc123`,
          Buffer.from("bytes"),
          "audio/wav",
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer bearer-token");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    /** @scenario "Reads of previously persisted azure-blob URIs succeed in a token-based mode" */
    it("serves a URI written under shared-key auth through the same registered driver", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 404 }));
      try {
        await expect(
          registryFor(KEYLESS_CONFIG, INJECTED_IDENTITY).exists(HISTORICAL_URI),
        ).resolves.toBe(false);

        // A 404 answered by the driver, so the URI genuinely reached Azure
        // rather than being refused earlier as an unconfigured scheme.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    /** @scenario "Out-of-band maintenance tasks authenticate the same way as the services" */
    it("hands a maintenance task the same credentials the request path resolves", async () => {
      const credentials = resolveAzureCredentials({
        config: KEYLESS_CONFIG,
        purpose: "write",
        identity: INJECTED_IDENTITY,
      });

      const destination = await policyFor(KEYLESS_CONFIG, INJECTED_IDENTITY).resolve(PROJECT_ID);

      expect(credentials.mode).toBe("workloadIdentity");
      expect(credentials).not.toHaveProperty("accountKey");
      expect(destination).toMatchObject({ accountName: credentials.accountName });
    });
  });

  describe("given azure account credentials but no container configured", () => {
    /** @scenario "A historical Azure object resolves without the write-only container" */
    it("dispatches a stored azure-blob URI to the driver rather than rejecting the scheme", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 404 }));
      try {
        await expect(registryFor(READ_ONLY_CONFIG).exists(HISTORICAL_URI)).resolves.toBe(false);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    /** @scenario "Writes still refuse without a container, naming it" */
    it("refuses to resolve a write destination, naming the container", () => {
      const writing = { ...READ_ONLY_CONFIG, backend: "azure" as const };

      expect(() => resolveAzureCredentials({ config: writing })).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => resolveAzureCredentials({ config: writing })).toThrow(/AZURE_BLOB_CONTAINER/);
    });
  });
});
