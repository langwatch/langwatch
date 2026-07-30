/** Base for every error this package raises. Never customer-facing (ADR-045) — its callers are workers. */
export class GroupQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A tenant id would collide with the spool's own key structure. */
export class InvalidTenantIdError extends GroupQueueError {
  constructor(readonly tenantId: string) {
    super(
      `tenant id must not contain "/", "{" or "}" (got ${JSON.stringify(tenantId)})`,
    );
  }
}

/** A body exceeds the spool's hard ceiling, rejected before any I/O. */
export class BlobTooLargeError extends GroupQueueError {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(`blob is ${bytes} bytes, over the ${maxBytes}-byte ceiling`);
  }
}

/** A body needs the durable tier but no durable store was injected. */
export class DurableStoreRequiredError extends GroupQueueError {
  constructor(readonly ref: string) {
    super(
      `blob "${ref}" exceeds the inline threshold but no durable store is configured`,
    );
  }
}
