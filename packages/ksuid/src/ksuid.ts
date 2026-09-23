import { encode, decode } from "./base62.ts";
import { DECODED_LEN, ENCODED_LEN, KSUID_REGEX } from "./constants.ts";
import { checkInstance, Instance } from "./instance.ts";
import type { ParsedKsuid } from "./types.ts";
import { checkPrefix, checkUint } from "./validation.ts";

/**
 * A K-Sortable Unique IDentifier (KSUID): globally unique, k-sortable, with an
 * environment prefix, resource type, 48-bit Unix timestamp, 8-byte instance
 * identifier and 32-bit sequence number.
 */
export class Ksuid {
  private readonly _environment: string;
  private readonly _resource: string;
  private readonly _timestamp: number;
  private readonly _instance: Instance;
  private readonly _sequenceId: number;
  private _string?: string;

  /**
   * Creates a new KSUID instance
   * @param environment - The environment (e.g., 'prod', 'dev', 'staging')
   * @param resource - The resource type (e.g., 'user', 'order', 'product')
   * @param timestamp - Unix timestamp in seconds (48-bit)
   * @param instance - The instance identifier
   * @param sequenceId - Sequence number for collision avoidance
   * @throws {ValidationError} If any parameter is invalid
   */
  constructor(
    environment: string,
    resource: string,
    timestamp: number,
    instance: Instance,
    sequenceId: number,
  ) {
    checkPrefix("environment", environment);
    checkPrefix("resource", resource);
    checkUint("timestamp", timestamp, 6);
    checkInstance("instance", instance);
    checkUint("sequenceId", sequenceId, 4);

    this._environment = environment;
    this._resource = resource;
    this._timestamp = timestamp;
    this._instance = instance;
    this._sequenceId = sequenceId;
  }

  /** The environment (e.g., 'prod', 'dev', 'staging') */
  get environment(): string {
    return this._environment;
  }

  /** The resource type (e.g., 'user', 'order', 'product') */
  get resource(): string {
    return this._resource;
  }

  /** Unix timestamp in seconds when the KSUID was created */
  get timestamp(): number {
    return this._timestamp;
  }

  /** The instance identifier */
  get instance(): Instance {
    return this._instance;
  }

  /** Sequence number for collision avoidance */
  get sequenceId(): number {
    return this._sequenceId;
  }

  /** JavaScript Date object representing the creation time */
  get date(): Date {
    return new Date(this._timestamp * 1000);
  }

  /**
   * Converts the KSUID to its string representation
   * @returns The KSUID as a string (e.g., 'user_0001q4bXFY4siSyoTTkaIIabGiMZo')
   */
  toString(): string {
    // Cache the string since it's immutable
    if (this._string) {
      return this._string;
    }

    const env = this._environment === "prod" ? "" : `${this._environment}_`;
    const prefix = `${env}${this._resource}_`;

    const decoded = new Uint8Array(DECODED_LEN);

    // Write timestamp (48 bits, 6 bytes)
    // Note: JavaScript can't store 64-bit numbers accurately, so we use 48 bits
    // This will become a problem at 8921556-12-07T10:44:16Z, lol
    decoded[0] = 0; // High byte always 0
    decoded[1] = 0; // High byte always 0
    decoded[2] = (this._timestamp >> 40) & 0xff;
    decoded[3] = (this._timestamp >> 32) & 0xff;
    decoded[4] = (this._timestamp >> 24) & 0xff;
    decoded[5] = (this._timestamp >> 16) & 0xff;
    decoded[6] = (this._timestamp >> 8) & 0xff;
    decoded[7] = this._timestamp & 0xff;

    // Write instance (9 bytes)
    const instanceBuffer = this._instance.toBuffer();
    decoded.set(instanceBuffer, 8);

    // Write sequence ID (4 bytes)
    decoded[17] = (this._sequenceId >> 24) & 0xff;
    decoded[18] = (this._sequenceId >> 16) & 0xff;
    decoded[19] = (this._sequenceId >> 8) & 0xff;
    decoded[20] = this._sequenceId & 0xff;

    const encoded = encode(decoded);
    const padded = encoded.padStart(ENCODED_LEN, "0");

    this._string = prefix + padded;
    return this._string;
  }

  /**
   * @param input - The KSUID string to parse
   * @returns A new Ksuid instance
   * @throws {Error} If the input is invalid or malformed
   */
  static parse(input: string): Ksuid {
    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }

    if (!input.length) {
      throw new Error("Input must not be empty");
    }

    const { environment, resource, encoded } = splitPrefixId(input);

    const decoded = decode(encoded);
    const fullDecoded = new Uint8Array(DECODED_LEN);

    // Copy the last DECODED_LEN bytes
    const start = Math.max(0, decoded.length - DECODED_LEN);
    fullDecoded.set(decoded.slice(start), DECODED_LEN - decoded.length + start);

    // Check if timestamp is too large
    if (fullDecoded[0] !== 0 || fullDecoded[1] !== 0) {
      throw new Error("Timestamp greater than 8921556-12-07T10:44:16Z");
    }

    const timestamp =
      (fullDecoded[2] << 40) |
      (fullDecoded[3] << 32) |
      (fullDecoded[4] << 24) |
      (fullDecoded[5] << 16) |
      (fullDecoded[6] << 8) |
      fullDecoded[7];

    const instance = Instance.fromBuffer(fullDecoded.slice(8, 17));

    const sequenceId =
      (fullDecoded[17] << 24) | (fullDecoded[18] << 16) | (fullDecoded[19] << 8) | fullDecoded[20];

    return new Ksuid(environment, resource, timestamp, instance, sequenceId);
  }

  /**
   * @param other - The KSUID to compare with
   * @returns True if both KSUIDs are equal, false otherwise
   */
  equals(other: Ksuid): boolean {
    if (!(other instanceof Ksuid)) {
      return false;
    }

    return (
      this._environment === other._environment &&
      this._resource === other._resource &&
      this._timestamp === other._timestamp &&
      this._instance.equals(other._instance) &&
      this._sequenceId === other._sequenceId
    );
  }

  /**
   * @returns An object containing all KSUID components
   */
  toJSON(): object {
    return {
      environment: this._environment,
      resource: this._resource,
      timestamp: this._timestamp,
      date: this.date.toISOString(),
      instance: {
        scheme: this._instance.scheme,
        identifier: Array.from(this._instance.identifier),
      },
      sequenceId: this._sequenceId,
      string: this.toString(),
    };
  }
}

function splitPrefixId(input: string): ParsedKsuid {
  const parsed = KSUID_REGEX.exec(input);

  if (!parsed) {
    throw new Error("ID is invalid");
  }

  const [, environment, resource, encoded] = parsed;

  if (environment === "prod") {
    throw new Error("Production environment is implied");
  }

  return {
    environment: environment || "prod",
    resource,
    encoded,
  };
}
