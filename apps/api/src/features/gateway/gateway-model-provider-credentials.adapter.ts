import { GatewayModelProviderCredentials } from "@langwatch/gateway-server";
import { EncryptedModelProviderCredentialAdapter } from "@langwatch/model-provider-server";
import type { SecretEncryption } from "@langwatch/secret-server";

/** Reads gateway provider keys through the model-provider feature's cipher. */
export class ApiGatewayModelProviderCredentials extends GatewayModelProviderCredentials {
  static create(encryption: SecretEncryption): ApiGatewayModelProviderCredentials {
    return new ApiGatewayModelProviderCredentials(encryption);
  }

  private constructor(private readonly encryption: SecretEncryption) {
    super();
  }

  readCustomKeys(stored: unknown): Record<string, unknown> {
    const read = EncryptedModelProviderCredentialAdapter.readCustomKeys(stored, this.encryption);

    return read.state === "read" ? read.keys : {};
  }
}
