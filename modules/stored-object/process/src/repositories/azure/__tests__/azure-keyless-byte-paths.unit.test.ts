/**
 * Issue #6087 — the byte paths that must keep working when Azure is configured
 * with an identity instead of an account key.
 * @vitest-environment node
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

import { resetAzureTokenCacheForTests } from "#repositories/azure/azure.blob-token.store";
import { AzureStoredObjectBlobRepository } from "#repositories/azure/azure.stored-object-blob.repository";
import type {
  AzureCredentials,
  AzureInjectedIdentity,
} from "#services/azure-blob-credentials.service";
import { StoredObjectStorageRegistryService } from "#services/stored-object-storage-registry.service";

const PROJECT_ID = "proj-1";
const HISTORICAL_URI = `azure-blob://lwacct/written-long-ago/${PROJECT_ID}/abc123`;

/** What the AKS workload-identity webhook writes into the pod. */
const INJECTED_IDENTITY: AzureInjectedIdentity = {
  tenantId: "tenant-id",
  clientId: "client-id",
  federatedTokenFile: "/var/run/secrets/azure/tokens/azure-identity-token",
};

/** A keyless install: identity mode, and no account key anywhere. */
const KEYLESS_CREDENTIALS: AzureCredentials = {
  mode: "workloadIdentity",
  accountName: "lwacct",
  identity: INJECTED_IDENTITY,
};

/** Account credentials retained for reads after writes moved off Azure, with no container. */
const READ_ONLY_CREDENTIALS: AzureCredentials = {
  mode: "sharedKey",
  accountName: "lwacct",
  accountKey: "a2V5",
};

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

/** The registry with its Azure arm built lazily from credentials. */
function registryFor(credentials: AzureCredentials): StoredObjectStorageRegistryService {
  return StoredObjectStorageRegistryService.create({
    s3: dispatchedElsewhere,
    file: dispatchedElsewhere,
    "azure-blob": () => AzureStoredObjectBlobRepository.create(credentials),
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
    it("dispatches an azure-blob write through a registered driver rather than an unconfigured scheme", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 201 }));
      try {
        await registryFor(KEYLESS_CREDENTIALS).put(
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
        await expect(registryFor(KEYLESS_CREDENTIALS).exists(HISTORICAL_URI)).resolves.toBe(false);

        // A 404 answered by the driver, so the URI genuinely reached Azure
        // rather than being refused earlier as an unconfigured scheme.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("given azure account credentials but no container configured", () => {
    /** @scenario "A historical Azure object resolves without the write-only container" */
    it("dispatches a stored azure-blob URI to the driver rather than rejecting the scheme", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 404 }));
      try {
        await expect(registryFor(READ_ONLY_CREDENTIALS).exists(HISTORICAL_URI)).resolves.toBe(
          false,
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
