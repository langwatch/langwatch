/**
 * Server capability for resolving a historical id-only file URL to its owner.
 * It is deliberately separate from ordinary project-scoped Stored Object I/O.
 */
export abstract class StoredObjectOwnerResolver {
  abstract resolve(input: { id: string }): Promise<{ projectId: string } | null>;
}

/** The cross-tenant resolver could not rule out an owner during a partial outage. */
export class StoredObjectOwnerLookupUnavailableError extends Error {
  readonly failedTargets: string[];

  constructor(failedTargets: string[]) {
    super(
      `cross-tenant owner lookup degraded: ${failedTargets.length} instance(s) failed (${failedTargets.join(", ")}); no hit on any healthy instance`,
    );
    this.name = "StoredObjectOwnerLookupUnavailableError";
    this.failedTargets = failedTargets;
  }
}
