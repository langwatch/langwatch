/**
 * Error thrown when validation fails
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates that a value is a valid prefix string (lowercase letters and digits only)
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @throws {ValidationError} If the value is not a valid prefix
 */
export function checkPrefix(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }

  if (!PREFIX_REGEX.test(value)) {
    throw new ValidationError(`${field} contains invalid characters`);
  }
}

/**
 * Validates that a value is a valid unsigned integer within the specified bit range
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @param byteLength - The number of bytes (determines bit range)
 * @throws {ValidationError} If the value is not a valid unsigned integer
 */
export function checkUint(
  field: string,
  value: unknown,
  byteLength: number,
): asserts value is number {
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }

  if ((value as number) < 0) {
    throw new ValidationError(`${field} must be positive`);
  }

  const maxValue = Math.pow(2, byteLength * 8) - 1;
  if ((value as number) > maxValue) {
    throw new ValidationError(`${field} must be a uint${byteLength * 8}`);
  }
}

/**
 * Validates that a value is a Uint8Array with the specified length
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @param byteLength - The expected length in bytes
 * @throws {ValidationError} If the value is not a Uint8Array with the correct length
 */
export function checkUint8Array(
  field: string,
  value: unknown,
  byteLength: number,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ValidationError(`${field} must be a Uint8Array or derivative`);
  }

  if ((value as Uint8Array).length !== byteLength) {
    throw new ValidationError(`${field} must be ${byteLength} bytes`);
  }
}

/**
 * Validates that a value is an instance of the specified class
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @param classType - The expected class constructor
 * @throws {ValidationError} If the value is not an instance of the specified class
 */
export function checkClass<T>(
  field: string,
  value: unknown,
  classType: new (..._args: never[]) => T,
): asserts value is T {
  if (!(value instanceof classType)) {
    throw new ValidationError(`${field} must be an instance of ${classType.name}`);
  }
}

/**
 * Validates that a value is a string
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @throws {ValidationError} If the value is not a string
 */
export function checkString(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
}

/**
 * Validates that a value is a non-empty string
 * @param field - The field name for error messages
 * @param value - The value to validate
 * @throws {ValidationError} If the value is not a non-empty string
 */
export function checkNonEmptyString(field: string, value: unknown): asserts value is string {
  checkString(field, value);
  if ((value as string).length === 0) {
    throw new ValidationError(`${field} must not be empty`);
  }
}

/** Length of decoded KSUID in bytes (timestamp + instance + sequence) */
export const DECODED_LEN = 21;

/** Length of base62 encoded KSUID payload */
export const ENCODED_LEN = 29;

/** Regex to match KSUID format: (env_)?resource_encoded */
export const KSUID_REGEX = /^(?:([a-z\d]+)_)?([a-z\d]+)_([a-zA-Z\d]{29})$/;

/** Regex to validate prefix characters (lowercase letters and digits) */
export const PREFIX_REGEX = /^[a-z\d]+$/;

/** Maximum timestamp value (48 bits) */
export const MAX_TIMESTAMP = 2n ** 48n - 1n;

/** Maximum date: 8921556-12-07T10:44:16Z */
export const MAX_DATE = new Date(Number(MAX_TIMESTAMP) * 1000);
