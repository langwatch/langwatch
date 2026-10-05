/**
 * The ownerless key one gateway trace project's spans are exported with; the token rests
 * encrypted.
 */
export type StoredGatewayTraceExportKey = Readonly<{
  projectId: string;
  apiKeyId: string;
  encryptedToken: string;
}>;

export abstract class GatewayTraceExportKeyRepository {
  /** The project's key, or an empty list where none was minted yet. */
  abstract findForProject(projectId: string): Promise<StoredGatewayTraceExportKey[]>;
  /** Stores the key unless the project already holds one, and answers whichever is kept. */
  abstract saveFirst(key: StoredGatewayTraceExportKey): Promise<StoredGatewayTraceExportKey>;
}
