import { describe, expect, it } from "vitest";
import { resolveAzureIdentityConfig } from "../azure-identity.config";

describe("resolveAzureIdentityConfig", () => {
  it("projects platform-injected identity values into typed Azure client configuration", () => {
    expect(
      resolveAzureIdentityConfig({
        AZURE_TENANT_ID: "tenant-id",
        AZURE_CLIENT_ID: "client-id",
        AZURE_FEDERATED_TOKEN_FILE: "/var/run/secrets/azure/token",
      }),
    ).toEqual({
      tenantId: "tenant-id",
      clientId: "client-id",
      federatedTokenFile: "/var/run/secrets/azure/token",
    });
  });
});
