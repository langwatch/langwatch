/**
 * Errors for the Dataset API
 */

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

export class DatasetNotFoundError extends DatasetError {
  constructor(slugOrId: string) {
    super(`Dataset not found: ${slugOrId}`);
    this.name = "DatasetNotFoundError";
  }
}

export class DatasetApiError extends DatasetError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DatasetApiError";
    this.status = status;
  }
}
