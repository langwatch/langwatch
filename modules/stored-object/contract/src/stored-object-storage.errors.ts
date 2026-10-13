/**
 * Failures the byte layer raises, as its callers recognise them.
 */

/** Raised when a storage address resolves but holds no bytes. */
export class ObjectNotFoundError extends Error {
  constructor(uri: string) {
    super(`Object not found: ${uri}`);
    this.name = "ObjectNotFoundError";
  }
}

/**
 * Raised when a driver is handed an address that belongs to another provider.
 */
export class UnsupportedStorageSchemeError extends Error {
  readonly scheme: string;
  readonly expectedScheme: string;

  constructor({
    uri,
    scheme,
    expectedScheme,
  }: {
    uri: string;
    scheme: string;
    expectedScheme: string;
  }) {
    super(`Expected a "${expectedScheme}" URI but got scheme "${scheme}": "${uri}"`);
    this.name = "UnsupportedStorageSchemeError";
    this.scheme = scheme;
    this.expectedScheme = expectedScheme;
  }
}
