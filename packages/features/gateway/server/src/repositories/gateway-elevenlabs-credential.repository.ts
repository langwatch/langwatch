/** The provider row an ElevenLabs credential read resolves, before decryption. */
export type GatewayElevenLabsProviderRow = {
  provider: string;
  organizationId: string;
  customKeys: unknown;
};

/**
 * The one row behind both ElevenLabs credential reads. Kept to the provider
 * row itself: the cipher belongs to the Model Provider feature's own reader,
 * which the service holds separately.
 */
export abstract class GatewayElevenLabsCredentialRepository {
  abstract findProviderRow(input: {
    modelProviderId: string;
  }): Promise<GatewayElevenLabsProviderRow | null>;
}
