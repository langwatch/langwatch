/**
 * Reads a model provider's stored custom keys.
 *
 * The rows are encrypted at rest with the deployment's credential cipher, and
 * the cipher belongs to the Model Provider feature. A gateway package may not
 * depend on another feature's server package, so the read arrives as a port
 * and the process wires `@langwatch/model-provider-server`'s lenient reader
 * behind it.
 */
export abstract class GatewayModelProviderCredentialsPort {
  abstract readCustomKeys(stored: unknown): Record<string, unknown>;
}
