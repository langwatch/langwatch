export type StoredObjectOwnerLookupSpan = Readonly<{
  setAttribute(name: string, value: string | number | boolean): void;
}>;

/**
 * Process observability stays at composition while the Stored Object owner
 * lookup records its fixed database-operation attributes through this port.
 */
export abstract class StoredObjectOwnerLookupTelemetryPort {
  abstract withLookupSpan<Result>(
    input: { id: string },
    operation: (span: StoredObjectOwnerLookupSpan) => Promise<Result>,
  ): Promise<Result>;
}
