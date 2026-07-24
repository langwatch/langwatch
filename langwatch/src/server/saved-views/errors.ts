/**
 * Domain-specific errors for saved view operations.
 * These are thrown by the service layer and mapped to tRPC errors by the router.
 */

export class SavedViewNotFoundError extends Error {
  constructor() {
    super("Saved view not found");
    this.name = "SavedViewNotFoundError";
  }
}

export class SavedViewReorderError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Saved views not found: ${missingIds.join(", ")}`);
    this.name = "SavedViewReorderError";
  }
}
