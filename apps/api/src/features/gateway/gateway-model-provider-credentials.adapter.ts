import { GatewayModelProviderCredentialsPort } from "@langwatch/gateway-server";
import { EncryptedModelProviderCredentialAdapter } from "@langwatch/model-provider-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

/** Reads gateway provider keys through the model-provider feature's cipher. */
export class ApiGatewayModelProviderCredentials extends GatewayModelProviderCredentialsPort {
  static create(encryption: SecretEncryptionPort): ApiGatewayModelProviderCredentials {
    return new ApiGatewayModelProviderCredentials(encryption);
  }

  private constructor(private readonly encryption: SecretEncryptionPort) {
    super();
  }

  readCustomKeys(stored: unknown): Record<string, unknown> {
    const read = EncryptedModelProviderCredentialAdapter.readCustomKeys(stored, this.encryption);

    return read.state === "read" ? read.keys : {};
  }
}
