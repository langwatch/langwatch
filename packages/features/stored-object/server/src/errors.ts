/**
 * Failures the byte layer raises, as its callers recognise them.
 *
 * Two classes, because the storage drivers only ever have two things to name:
 * the address resolved and nothing is there, and the address belongs to a
 * different provider than the driver holding it. Every other provider failure —
 * a refused credential, a network reset, a bucket policy — stays itself, so it
 * degrades to an unknown error with a trace id rather than being reported to a
 * reader as "your file is gone".
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
 *
 * The address is not a customer input and nobody outside the process can act
 * on it, so this stays a plain named Error and degrades to unknown with a
 * trace id at the boundary. `name` is the stable discriminant.
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
