import { PREFIX_REGEX } from "./constants.ts";

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
